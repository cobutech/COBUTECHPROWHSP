const set = require("./set.js");
const fs = require('fs');
const { exec } = require('child_process');
const moment = require("moment-timezone"); // Added for time calculations

// Helper function to save settings (mode, blocked users, warnings)
function saveSettings(newSettings) {
    try {
        const content = `module.exports = ${JSON.stringify(newSettings, null, 4)};\n`;
        fs.writeFileSync("./set.js", content, 'utf8');
        console.log("[CONFIG] Settings updated and saved to set.js");
    } catch (error) {
        console.error("[CONFIG] Failed to save settings:", error);
    }
}

// Define the commands for the menu (category: Bot)
const commands = [
    { name: "menu", category: "Bot" },
    { name: "public", category: "Bot" },
    { name: "private", category: "Bot" },
    { name: "on", category: "Bot" },
    { name: "off", category: "Bot" },
    { name: "restart", category: "Bot" },
    { name: "update", category: "Bot" },
    { name: "uptime", category: "Bot" },
    { name: "speed", category: "Bot" },
];

// Helper function to calculate uptime string
function getUptimeString(startTime) {
    const diff = Date.now() - startTime;
    const seconds = Math.floor((diff / 1000) % 60);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    let uptime = "";
    if (days) uptime += `${days}D `;
    if (hours) uptime += `${hours}H `;
    if (minutes) uptime += `${minutes}M `;
    uptime += `${seconds}S`;
    return uptime.trim();
}

module.exports = async function handleUptimeCommand(sock, msg, startTime) {
    const m = msg.message;
    const senderJid = msg.key.remoteJid;
    const userJid = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : (msg.key.participant || msg.key.remoteJid);
    const isOwner = userJid === set.masterJid;
    
    const messageText =
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId || m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        "";

    const prefix = set.prefix;

    const forwardedInfo = {
        contextInfo: {
            isForwarded: true,
            forwardingScore: 999,
            mentionedJid: [],
            externalAdReply: {
                title: `from ${set.botName}`
            }
        }
    };

    console.log(`📩 Message from ${userJid}:`, messageText || "No Text");
    
    // ----------------------------------------------------
    // 1. GLOBAL BLOCK CHECK
    // ----------------------------------------------------
    if (set.blockedUsers.includes(userJid)) {
        console.log(`[BLOCK] Blocking message from ${userJid}`);
        return; // Ignore message from blocked user
    }
    
    // ----------------------------------------------------
    // 2. BOT ENABLED/DISABLED CHECK
    // ----------------------------------------------------
    if (!set.botEnabled) {
        if (messageText.trim() === `${prefix}on` && isOwner) {
            set.botEnabled = true;
            saveSettings(set);
            await sock.sendMessage(senderJid, { text: "`✅ Bot back online — Ready again!`", ...forwardedInfo });
            console.log("[BOT] Enabled");
        }
        return;
    }
    
    // ----------------------------------------------------
    // 3. PRIVATE/PUBLIC MODE CHECK & WARNINGS
    // ----------------------------------------------------
    if (set.mode === "private" && !isOwner) {
        const isCommand = messageText.startsWith(prefix);
        if (isCommand) {
            const currentWarnings = set.warningCounts[userJid] || 0;
            const newWarnings = currentWarnings + 1;

            if (newWarnings >= 3) {
                set.blockedUsers.push(userJid);
                delete set.warningCounts[userJid];
                saveSettings(set);
                
                await sock.sendMessage(senderJid, {
                    text: `⚠️ Final Warning! This bot is in **Private Mode**. Since you tried to use it ${newWarnings} times, you have been **BLOCKED** from accessing all features.`,
                    ...forwardedInfo
                });
                console.log(`[MODE] User ${userJid} blocked for misuse in Private Mode.`);
                return; 
            } else {
                set.warningCounts[userJid] = newWarnings;
                saveSettings(set);
                
                await sock.sendMessage(senderJid, {
                    text: `⚠️ Warning ${newWarnings}/3: This bot is currently set to **Private Mode**. Only the owner can use it. Repeated use will result in a block.`,
                    ...forwardedInfo
                });
                console.log(`[MODE] User ${userJid} warned (${newWarnings}/3).`);
            }
        }
        return; // Block non-owner commands in Private mode
    }

    // ----------------------------------------------------
    // 4. COMMAND PROCESSING
    // ----------------------------------------------------
    if (!messageText.startsWith(prefix)) return;
    const command = messageText.slice(prefix.length).trim().split(" ")[0].toLowerCase();

    // Owner Commands (Require isOwner === true)
    if (["off", "restart", "update", "public", "private"].includes(command) && !isOwner) {
        await sock.sendMessage(senderJid, {
            text: `🔒 Command ${prefix}${command} is restricted to the bot owner.`,
            ...forwardedInfo
        });
        return;
    }

    // OFF COMMAND
    if (command === "off") {
        set.botEnabled = false;
        saveSettings(set); 
        
        const buttons = [
            { buttonId: `${prefix}on`, buttonText: { displayText: "🟢 Turn Bot ON" }, type: 1 }
        ];

        await sock.sendMessage(senderJid, {
            text: "Bot is now **OFF**. Click the button below to turn it back on.",
            buttons: buttons,
            headerType: 1
        }, forwardedInfo);

        console.log("[BOT] Disabled");
        return;
    }

    // PUBLIC COMMAND (Owner-Only)
    if (command === "public") {
        set.mode = "public";
        saveSettings(set);
        await sock.sendMessage(senderJid, {
            text: `📢 Bot is now in **Public Mode**. Anyone can use the commands.`,
            ...forwardedInfo
        });
        return;
    }

    // PRIVATE COMMAND (Owner-Only)
    if (command === "private") {
        set.mode = "private";
        saveSettings(set);
        await sock.sendMessage(senderJid, {
            text: `🔒 Bot is now in **Private Mode**. Only the owner can use commands. Non-owners will be warned and blocked.`,
            ...forwardedInfo
        });
        return;
    }

    // ON COMMAND (State check)
    if (command === "on") {
        if (set.botEnabled) {
             await sock.sendMessage(senderJid, { text: "Bot is already **ON**. You can continue using it.", ...forwardedInfo });
            return;
        }
        return;
    }

    // RESTART (Owner-Only)
    if (command === "restart") {
        await sock.sendMessage(senderJid, { text: "`🔄 Bot is restarting now. Please wait a moment...`", ...forwardedInfo });
        try {
            if (sock.end) { await sock.end(); } else if (sock.close) { await sock.close(); }
        } catch (e) {
            console.error("[BOT] Error closing socket, proceeding with exit:", e.message);
        }
        process.exit(0);
    }

    // UPDATE (Owner-Only)
    if (command === "update") {
        await sock.sendMessage(senderJid, { text: "`🔍 Please wait a moment while I check for available updates...`", ...forwardedInfo });

        try {
            const gitPullResult = await new Promise((resolve, reject) => {
                exec('git pull', (error, stdout, stderr) => {
                    if (error) return reject(error);
                    resolve({ stdout, stderr });
                });
            });

            const output = gitPullResult.stdout.trim();

            if (output.includes("Already up to date") || output.includes("up to date")) {
                const buttons = [{ buttonId: `${prefix}enablenotice`, buttonText: { displayText: "🔔 Enable Update Notice" }, type: 1 }];
                await sock.sendMessage(senderJid, { text: "🎉 Bot is up to date! Enjoy the features. If an update is due, you'll get the notice.", buttons: buttons, headerType: 1 }, forwardedInfo);
            } else {
                const buttons = [{ buttonId: `${prefix}restart`, buttonText: { displayText: "🔄 Restart Bot Now" }, type: 1 }];
                await sock.sendMessage(senderJid, { text: "✅ Update found and applied. Please restart the bot to load the new features.", buttons: buttons, headerType: 1 }, forwardedInfo);
            }

        } catch (error) {
            await sock.sendMessage(senderJid, { text: `❌ Update check failed! Ensure Git is installed and you are in a Git repository. Error: ${error.message}`, ...forwardedInfo });
        }
        return;
    }
    
    // ENABLENOTICE
    if (command === "enablenotice") {
        set.updateNoticeEnabled = true;
        saveSettings(set); 
        await sock.sendMessage(senderJid, { text: "🔔 Update notices have been enabled! You will be notified automatically when an update is available.", ...forwardedInfo });
        return;
    }

    // MENU COMMAND: Calculate speed/uptime/time here before calling menu.js
    if (command === "menu") {
        // 1. Calculate Uptime
        const uptime = getUptimeString(startTime);

        // 2. Calculate Ping/Speed
        const start = Date.now();
        await sock.sendMessage(senderJid, { text: "`Calculating speed for menu...`", ...forwardedInfo });
        const ping = Date.now() - start;

        // 3. Get local time in a fixed, known timezone (e.g., Africa/Nairobi)
        const localTime = moment().tz("Africa/Nairobi");
        
        // Pass all data to menu.js
        const menuLogic = require('./menu.js');
        return menuLogic(sock, { 
            msg: msg, 
            commands: commands, 
            uptime: uptime, 
            speed: `${ping}ms`,
            localTime: localTime // Pass moment object
        }, forwardedInfo);
    }
    
    // UPTIME
    if (command === "uptime") {
        const uptime = getUptimeString(startTime);
        await sock.sendMessage(senderJid, { text: `Uptime: ${uptime}`, ...forwardedInfo });
        return;
    }

    // SPEED
    if (command === "speed") {
        const start = Date.now();
        await sock.sendMessage(senderJid, { text: "`Processing speed check...`", ...forwardedInfo });
        const ping = Date.now() - start;
        await sock.sendMessage(senderJid, { text: `Speed: ${ping}ms`, ...forwardedInfo });
        return;
    }
};