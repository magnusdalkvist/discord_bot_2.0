const fs = require("fs");
const path = require("path");

const SUBSCRIPTIONS_FILE = path.join(__dirname, "..", "subscriptions.json");

// Cooldown tracking: Map<guildId:targetUserId, timestamp>
const notificationCooldowns = new Map();

// Grace period pending notifications: Map<guildId:targetUserId, timeoutId>
const pendingNotifications = new Map();

// Cooldown duration in milliseconds (5 minutes)
const COOLDOWN_MS = 5 * 60 * 1000;

// Grace period in milliseconds — wait before sending notification to avoid brief reconnects
const GRACE_PERIOD_MS = 5 * 1000;

/**
 * Load subscriptions from file
 * @returns {Object} { guildId: { subscriberUserId: [targetUserId, ...] } }
 */
function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const data = fs.readFileSync(SUBSCRIPTIONS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading subscriptions:", error);
  }
  return {};
}

/**
 * Save subscriptions to file
 * @param {Object} subscriptions
 */
function saveSubscriptions(subscriptions) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
  } catch (error) {
    console.error("Error saving subscriptions:", error);
  }
}

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

  const subs = loadSubscriptions();
  if (!subs[guildId]) subs[guildId] = {};
  if (!subs[guildId][subscriberUserId]) subs[guildId][subscriberUserId] = [];

  if (subs[guildId][subscriberUserId].includes(targetUserId)) {
    return { success: false, message: "You're already subscribed to this user!" };
  }

  subs[guildId][subscriberUserId].push(targetUserId);
  saveSubscriptions(subs);
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
  const subs = loadSubscriptions();
  if (
    !subs[guildId] ||
    !subs[guildId][subscriberUserId] ||
    !subs[guildId][subscriberUserId].includes(targetUserId)
  ) {
    return { success: false, message: "You're not subscribed to this user!" };
  }

  subs[guildId][subscriberUserId] = subs[guildId][subscriberUserId].filter(
    (id) => id !== targetUserId,
  );

  // Clean up empty arrays/objects
  if (subs[guildId][subscriberUserId].length === 0) {
    delete subs[guildId][subscriberUserId];
  }
  if (Object.keys(subs[guildId]).length === 0) {
    delete subs[guildId];
  }

  saveSubscriptions(subs);
  return { success: true, message: "Successfully unsubscribed!" };
}

/**
 * Get all subscriptions for a user in a guild
 * @param {string} guildId
 * @param {string} subscriberUserId
 * @returns {string[]} Array of target user IDs
 */
function getSubscriptions(guildId, subscriberUserId) {
  const subs = loadSubscriptions();
  return subs[guildId]?.[subscriberUserId] || [];
}

/**
 * Get all subscribers for a target user in a guild
 * (i.e., who wants to be notified when targetUserId joins)
 * @param {string} guildId
 * @param {string} targetUserId
 * @returns {string[]} Array of subscriber user IDs
 */
function getSubscribers(guildId, targetUserId) {
  const subs = loadSubscriptions();
  const guildSubs = subs[guildId];
  if (!guildSubs) return [];

  const subscribers = [];
  for (const [subscriberId, targets] of Object.entries(guildSubs)) {
    if (targets.includes(targetUserId)) {
      subscribers.push(subscriberId);
    }
  }
  return subscribers;
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
