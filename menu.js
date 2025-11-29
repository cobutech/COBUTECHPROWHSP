const os = require("os");
const moment = require("moment-timezone");
function getGreeting(localTime, name) {
    const hour = localTime.hour();
    let greeting = "𝐻𝐸𝐿𝐿𝑂";
    if (hour >= 5 && hour < 12) {
        greeting = "𝐺𝑂𝑂𝐷 𝑀𝑂𝑅𝑁𝐼𝑁𝐺";
    } else if (hour >= 12 && hour < 18) {
        greeting = "𝐺𝑂𝑂𝐷 𝐴𝐹𝑇𝐸𝑅𝑁𝑂𝑂𝑁";
    } else if (hour >= 18 || hour < 5) {
        greeting = "𝐺𝑂𝑂𝐷 𝐸𝑉𝐸𝑁𝐼𝑁𝐺";
    }
    
    return `👋 ${greeting} ${name} 👋`;
}
module.exports = async function handleMenuCommand(sock, options, forwardedInfo) {
    const { msg, commands, uptime, speed, localTime } = options;
    const { remoteJid: dest, pushName: nomAuteurMessage } = msg.key;
    const prefixe = require("./set").prefix;
    const s = require("./set");
    var coms = {};
    const displayCommands = commands.filter(cmd => !["enablenotice"].includes(cmd.name));

    displayCommands.map((com) => {
        const category = com.category || "General";
        if (!coms[category]) coms[category] = [];
        coms[category].push(com.name);
    });

    // Determine the mode string
    var mode = (s.mode).toLowerCase() === "private" ? "𝑃𝑅𝐼𝑉𝐴𝑇𝐸" : "𝑃𝑈𝐵𝐿𝐼𝐶𝐾";

    // Format time/date and greeting
    const temps = localTime.format('HH:mm:ss');
    const date = localTime.format('DD/MM/YYYY');
    const greeting = getGreeting(localTime, nomAuteurMessage);
    
    // Extract the owner's number (the JID prefix)
    const ownerJidPrefix = s.masterJid.split('@')[0];

    // Info Message Block
    let infoMsg =  `
╭───✧${s.botName}✧───◆
│   *𝑃𝑅𝐸𝐹𝐼𝑋* :[ ${prefixe} ]
│   *𝑂𝑊𝑁𝐸𝑅 𝑁𝐴𝑀𝐸* :[ ${ownerJidPrefix} ]
│   *𝑂𝑊𝑁𝐸𝑅 𝑁𝑈𝑀𝐵𝐸𝑅* :[ ${ownerJidPrefix} ]
│   *𝑀𝑂𝐷𝐸* :[ ${mode} ]
│   *𝐶𝑂𝑀𝑀𝐴𝑁𝐷𝑆* :[ ${displayCommands.length} ]
│   *𝑈𝑃𝑇𝐼𝑀𝐸* :[ ${uptime} ]
│   *𝑆𝑃𝐸𝐸𝐷* :[ ${speed} ]
│   *𝐷𝐴𝑇𝐸* :[ ${date} ]
│   *𝑇𝐼𝑀𝐸* :[ ${temps} ]
│   *𝑀𝐸𝑀𝑂𝑅𝑌* :[ ${(os.totalmem() - os.freemem()).toFixed(2)}𝑀𝐵 / ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} 𝐺𝐵 ]
│   *𝑃𝐿𝐴𝑇𝐹𝑂𝑅𝑀* :[ ${os.platform()} ]
│   *𝐷𝐸𝑉𝐸𝐿𝑂𝑃𝐸𝑅* :[ 𝐶𝑂𝐵𝑈𝑇𝐸𝐶𝐻-𝐼𝑁𝐷𝑈𝑆𝑇𝑅𝑌 ]
╰───✧𝐶𝑂𝐵𝑈-𝑇𝐸𝐶𝐻-𝐼𝑁𝐷𝑈𝑆𝑇𝑅𝑌✧──◆ \n\n`;
    let menuMsg = `
${greeting}

*𝐶𝑂𝑀𝐴𝑁𝐷 𝑀𝐸𝑁𝑁𝑈:*
◇                             ◇
`;
    for (const cat in coms) {
        menuMsg += `╭────❏ *${cat}* ❏`;
        for (const cmd of coms[cat]) {
            menuMsg += `
│ ${prefixe}${cmd}`; 
        }
        menuMsg += `
╰═════════════⊷ \n`
    }

    menuMsg += `
    ◇            ◇
*»»————— ★ —————««*
𝑇𝑌𝑃𝐸 𝑇𝐻𝐸 𝐶𝑂𝑀𝑀𝐴𝑁𝐷 𝑇𝐻𝐸𝑁 𝑈𝑆𝐸 : " ${prefixe} " :𝐴𝑆 𝑇𝐻𝐸 𝑃𝑅𝐸𝐹𝐼𝑋"
    
    𝑃𝑂𝑊𝐸𝑅𝐸𝐷 𝐵𝑌 𝑇𝐻𝐸 𝑃𝑂𝑊𝐸𝑅 𝑂𝐹 ${s.botName}
                                                
*»»————— ★ —————««*
`;
    
    const finalCaption = infoMsg + menuMsg;

    // --- 2. SEND IMAGE MESSAGE ---
    try {
        await sock.sendMessage(dest, { 
            image: { url: s.menuImageUrl }, 
            caption: finalCaption,         
            footer: `Je suis *${s.botName}*`,
            ...forwardedInfo 
        });
    }
    catch (e) {
        console.error("🥵🥵 Menu Image Error: " + e);
        await sock.sendMessage(dest, { text: finalCaption, footer: `Je suis *${s.botName}*`, ...forwardedInfo });
    }
    if (s.menuAudioUrl && s.menuAudioUrl !== "cobutech.mp3") {
        try {
            await sock.sendMessage(dest, { 
                audio: { url: s.menuAudioUrl },
                mimetype: 'audio/mp4', 
                ptt: true,             
            });
        } catch (e) {
            console.error("🥵🥵 Menu Audio Error: " + e);
        }
    }
};