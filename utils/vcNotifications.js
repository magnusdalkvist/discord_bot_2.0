const db = require("./db");

const getSubscriptionsStmt = db.prepare(
  "SELECT target_id FROM subscriptions WHERE guild_id = ? AND subscriber_id = ?"
);
const getSubscribersStmt = db.prepare(
  "SELECT subscriber_id FROM subscriptions WHERE guild_id = ? AND target_id = ?"
);
const hasSubscriptionStmt = db.prepare(
  "SELECT 1 FROM subscriptions WHERE guild_id = ? AND subscriber_id = ? AND target_id = ?"
);
const insertSubscriptionStmt = db.prepare(
  "INSERT INTO subscriptions (guild_id, subscriber_id, target_id) VALUES (?, ?, ?)"
);
const deleteSubscriptionStmt = db.prepare(
  "DELETE FROM subscriptions WHERE guild_id = ? AND subscriber_id = ? AND target_id = ?"
);

// Cooldown tracking: Map<guildId:targetUserId, timestamp>
const notificationCooldowns = new Map();

// Grace period pending notifications: Map<guildId:targetUserId, timeoutId>
const pendingNotifications = new Map();

// Cooldown duration in milliseconds (5 minutes)
const COOLDOWN_MS = 5 * 60 * 1000;

// Grace period in milliseconds — wait before sending notification to avoid brief reconnects
const GRACE_PERIOD_MS = 5 * 1000;

/**
 * Subscribe a user to another user's VC joins in a guild
 * @param {string} guildId
 * @param {string} subscriberUserId - The user who wants notifications
 * @param {string} targetUserId - The user to watch
 * @returns {{ success: boolean, message: string }}
 */
function subscribe(guildId, subscriberUserId, targetUserId) {
  if (subscriberUserId === targetUserId) {
    return { success: false, message: "You can't subscribe to yourself!" };
  }

  if (hasSubscriptionStmt.get(guildId, subscriberUserId, targetUserId)) {
    return { success: false, message: "You're already subscribed to this user!" };
  }

  insertSubscriptionStmt.run(guildId, subscriberUserId, targetUserId);
  return { success: true, message: "Successfully subscribed!" };
}

/**
 * Unsubscribe a user from another user's VC joins in a guild
 * @param {string} guildId
 * @param {string} subscriberUserId
 * @param {string} targetUserId
 * @returns {{ success: boolean, message: string }}
 */
function unsubscribe(guildId, subscriberUserId, targetUserId) {
  if (!hasSubscriptionStmt.get(guildId, subscriberUserId, targetUserId)) {
    return { success: false, message: "You're not subscribed to this user!" };
  }

  deleteSubscriptionStmt.run(guildId, subscriberUserId, targetUserId);
  return { success: true, message: "Successfully unsubscribed!" };
}

/**
 * Get all subscriptions for a user in a guild
 * @param {string} guildId
 * @param {string} subscriberUserId
 * @returns {string[]} Array of target user IDs
 */
function getSubscriptions(guildId, subscriberUserId) {
  return getSubscriptionsStmt.all(guildId, subscriberUserId).map((row) => row.target_id);
}

/**
 * Get all subscribers for a target user in a guild
 * (i.e., who wants to be notified when targetUserId joins)
 * @param {string} guildId
 * @param {string} targetUserId
 * @returns {string[]} Array of subscriber user IDs
 */
function getSubscribers(guildId, targetUserId) {
  return getSubscribersStmt.all(guildId, targetUserId).map((row) => row.subscriber_id);
}

/**
 * Check if a notification is on cooldown
 * @param {string} guildId
 * @param {string} targetUserId
 * @returns {boolean}
 */
function isOnCooldown(guildId, targetUserId) {
  const key = `${guildId}:${targetUserId}`;
  const lastNotified = notificationCooldowns.get(key);
  if (!lastNotified) return false;
  return Date.now() - lastNotified < COOLDOWN_MS;
}

/**
 * Set the cooldown for a target user in a guild
 * @param {string} guildId
 * @param {string} targetUserId
 */
function setCooldown(guildId, targetUserId) {
  const key = `${guildId}:${targetUserId}`;
  notificationCooldowns.set(key, Date.now());
}

/**
 * Cancel any pending notification for a target user (e.g., they left quickly)
 * @param {string} guildId
 * @param {string} targetUserId
 */
function cancelPendingNotification(guildId, targetUserId) {
  const key = `${guildId}:${targetUserId}`;
  const timeout = pendingNotifications.get(key);
  if (timeout) {
    clearTimeout(timeout);
    pendingNotifications.delete(key);
  }
}

/**
 * Schedule a notification after the grace period.
 * If the user leaves before the grace period ends, the notification is cancelled.
 * @param {Object} params
 * @param {string} params.guildId
 * @param {string} params.targetUserId
 * @param {Object} params.voiceChannel - The voice channel the target joined
 * @param {Object} params.guild - The Discord guild object
 * @param {string} params.targetDisplayName - Display name of the target user
 */
function scheduleNotification({ guildId, targetUserId, voiceChannel, guild, targetDisplayName }) {
  const key = `${guildId}:${targetUserId}`;

  // Cancel any existing pending notification for this user
  cancelPendingNotification(guildId, targetUserId);

  // Check cooldown before even scheduling
  if (isOnCooldown(guildId, targetUserId)) {
    return;
  }

  const timeout = setTimeout(async () => {
    pendingNotifications.delete(key);

    // Re-check cooldown (could have been set by another event in the meantime)
    if (isOnCooldown(guildId, targetUserId)) {
      return;
    }

    // Verify the target user is still in the voice channel
    let currentChannel;
    try {
      const targetMember = await guild.members.fetch(targetUserId);
      currentChannel = targetMember.voice?.channel;
    } catch (error) {
      console.error("Error fetching target member for VC notification:", error);
      return;
    }

    if (!currentChannel) {
      // User already left, don't notify
      return;
    }

    // Get all subscribers
    const subscribers = getSubscribers(guildId, targetUserId);
    if (subscribers.length === 0) return;

    // Set cooldown now that we're actually sending notifications
    setCooldown(guildId, targetUserId);

    // Build the invite link for the voice channel
    const channelLink = `https://discord.com/channels/${guildId}/${currentChannel.id}`;

    for (const subscriberId of subscribers) {
      // Check if subscriber is already in a voice channel in this guild
      try {
        const subscriberMember = await guild.members.fetch(subscriberId);

        // Skip if subscriber is already in a voice channel
        if (subscriberMember.voice?.channel) {
          continue;
        }

        // Try to DM the subscriber
        try {
          const user = await guild.client.users.fetch(subscriberId);
          await user.send(
            `**${targetDisplayName}** just joined **${currentChannel.name}** in **${guild.name}**! [Click here to join](${channelLink})`
          );
        } catch (dmError) {
          // User likely has DMs closed — silently ignore
          console.warn(
            `Could not DM subscriber ${subscriberId} for VC notification: ${dmError.message}`,
          );
        }
      } catch (error) {
        console.error(`Error processing subscriber ${subscriberId}:`, error);
      }
    }
  }, GRACE_PERIOD_MS);

  pendingNotifications.set(key, timeout);
}

module.exports = {
  subscribe,
  unsubscribe,
  getSubscriptions,
  getSubscribers,
  scheduleNotification,
  cancelPendingNotification,
};
