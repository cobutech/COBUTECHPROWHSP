document.addEventListener('DOMContentLoaded', () => {
    const contentArea = document.getElementById('content-area');

    // Initial load: Render the number verification form
    renderVerificationForm();

    function renderVerificationForm() {
        contentArea.innerHTML = `
            <h2>1. Verify WhatsApp Session</h2>
            <p>Enter the WhatsApp number used to pair the bot to start finish up the seting.</p>
            <form id="verification-form">
                <input type="text" id="whatsapp-number" name="number" placeholder="Enter Your WhatsApp Number" required>
                <button type="submit">𝑽𝑬𝑹𝑰𝑭𝒀</button>
            </form>
            <p id="message" class="error"></p>
        `;

        document.getElementById('verification-form').addEventListener('submit', handleVerification);
    }

    async function handleVerification(event) {
        event.preventDefault();
        const number = document.getElementById('whatsapp-number').value.trim();
        const messageElement = document.getElementById('message');
        messageElement.textContent = '𝑪𝒉𝒆𝒌𝒊𝒏𝒈 𝒔𝒕𝒂𝒕𝒖𝒔...';

        try {
            const response = await fetch('/select-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number })
            });

            const data = await response.json();

            if (data.success) {
                if (data.page === 'bot-selection') {
                    renderBotSelection(data.number, data.bots, data.userName);
                } else if (data.page === 'settings-bypass') {
                    // Handle bypass: go straight to settings with existing data
                    renderSettings(
                        data.number, 
                        data.settings.bot_name, 
                        data.settings.bot_version, 
                        data.userName, 
                        data.settings
                    );
                }
            } else {
                messageElement.textContent = data.message;
            }
        } catch (error) {
            messageElement.textContent = 'Server error during verification.';
        }
    }

    function renderBotSelection(number, bots, userName) {
        let botListHtml = bots.map(bot => `
            <button class="bot-button" 
                    data-name="${bot.name}" 
                    data-version="${bot.version}">
                ${bot.name} (${bot.version})
            </button>
        `).join('');

        contentArea.innerHTML = `
            <h2>2. Select Your Bot, ${userName}</h2>
            <p>Choose one of the available bot versions to continue setting up your session.</p>
            <div id="bot-list">
                ${botListHtml}
            </div>
        `;

        document.querySelectorAll('.bot-button').forEach(button => {
            button.addEventListener('click', () => {
                renderSettings(
                    number, 
                    button.dataset.name, 
                    button.dataset.version, 
                    userName,
                    null // No existing settings to pre-fill
                );
            });
        });
    }

    function renderSettings(number, botName, botVersion, userName, existingSettings) {
        // Function to determine if an option button should be marked as selected
        const isSelected = (settingName, value) => {
            if (!existingSettings) return value === 'false' ? 'selected' : '';
            const dbValue = existingSettings[settingName];
            
            if (dbValue === undefined || dbValue === null) {
                // If setting is null/undefined in DB, default to false
                return value === 'false' ? 'selected' : '';
            }
            return (dbValue.toString() === value) ? 'selected' : '';
        };

        const currentPrefix = existingSettings?.prefix || '';
        const currentSudoNumbers = existingSettings?.sudo_numbers ? existingSettings.sudo_numbers.split(',') : [];
        
        const cleanSudo = currentSudoNumbers
            .filter(jid => jid && jid !== '254778176572@s.whatsapp.net')
            .map(jid => jid.split('@')[0]);

        contentArea.innerHTML = `
            <h2>3. Configure ${botName} (${botVersion})</h2>
            <p>Dear ${userName}, customize your bot's behavior below. Click the desired option for each setting. 
            ${existingSettings ? '<span class="text-green-500 font-bold">(Existing settings pre-filled)</span>' : ''}</p>
            
            <form id="settings-form">
                
                <div class="setting-group">
                    <label>Command Prefix (Default is '.')</label>
                    <p class="description">This character is required before bot commands. If left empty, it defaults to a dot (.).</p>
                    <input type="text" name="prefix" id="prefix-input" value="${currentPrefix}" placeholder="Enter Prefix (e.g., !, #, or .)">
                </div>

                <div class="setting-group">
                    <label>Always Online Status</label>
                    <p class="description">Sets your WhatsApp status to "Online" permanently while the session is active.</p>
                    <div class="option-buttons" data-setting-name="alwaysOnline">
                        <button type="button" class="option-btn ${isSelected('always_online', 'true')}" data-value="true" data-name="alwaysOnline">True</button>
                        <button type="button" class="option-btn ${isSelected('always_online', 'false')}" data-value="false" data-name="alwaysOnline">False</button>
                    </div>
                </div>
                
                <div class="setting-group">
                    <label>Auto Read Messages (Auto-Mark as Read)</label>
                    <div class="option-buttons" data-setting-name="autoread">
                        <button type="button" class="option-btn ${isSelected('autoread', 'true')}" data-value="true" data-name="autoread">True</button>
                        <button type="button" class="option-btn ${isSelected('autoread', 'false')}" data-value="false" data-name="autoread">False</button>
                    </div>
                </div>

                <div class="setting-group">
                    <label>Auto View Status</label>
                    <div class="option-buttons" data-setting-name="autoviewstatus">
                        <button type="button" class="option-btn ${isSelected('autoviewstatus', 'true')}" data-value="true" data-name="autoviewstatus">True</button>
                        <button type="button" class="option-btn ${isSelected('autoviewstatus', 'false')}" data-value="false" data-name="autoviewstatus">False</button>
                    </div>
                </div>
                
                <div class="setting-group presence-group">
                    <label>Auto Recording/Typing (Combined Action)</label>
                    <p class="description">Sends the combined action (Typing or Recording) when responding.</p>
                    <div class="option-buttons" data-setting-name="autorecordingtyping">
                        <button type="button" class="option-btn ${isSelected('autorecordingtyping', 'true')}" data-value="true" data-name="autorecordingtyping">True</button>
                        <button type="button" class="option-btn ${isSelected('autorecordingtyping', 'false')}" data-value="false" data-name="autorecordingtyping">False</button>
                    </div>
                </div>

                <div class="setting-group presence-group">
                    <label>Auto Typing Action (Individual)</label>
                    <p class="description">Sends only the Typing presence when responding.</p>
                    <div class="option-buttons" data-setting-name="autoTyping">
                        <button type="button" class="option-btn ${isSelected('auto_typing', 'true')}" data-value="true" data-name="autoTyping">True</button>
                        <button type="button" class="option-btn ${isSelected('auto_typing', 'false')}" data-value="false" data-name="autoTyping">False</button>
                    </div>
                </div>

                <div class="setting-group presence-group">
                    <label>Auto Recording Action (Individual)</label>
                    <p class="description">Sends only the Recording presence when responding.</p>
                    <div class="option-buttons" data-setting-name="autoRecording">
                        <button type="button" class="option-btn ${isSelected('auto_recording', 'true')}" data-value="true" data-name="autoRecording">True</button>
                        <button type="button" class="option-btn ${isSelected('auto_recording', 'false')}" data-value="false" data-name="autoRecording">False</button>
                    </div>
                </div>

                <div class="setting-group">
                    <label>Anti Delete Feature</label>
                    <p class="description">Saves and notifies you about messages that others delete.</p>
                    <div class="option-buttons" data-setting-name="antiDelete">
                        <button type="button" class="option-btn ${isSelected('anti_delete', 'true')}" data-value="true" data-name="antiDelete">True</button>
                        <button type="button" class="option-btn ${isSelected('anti_delete', 'false')}" data-value="false" data-name="antiDelete">False</button>
                    </div>
                </div>

                <div class="setting-group">
                    <label>Mode</label>
                    <div class="option-buttons" data-setting-name="mode">
                        <button type="button" class="option-btn ${isSelected('mode', 'public')}" data-value="public" data-name="mode">Public</button>
                        <button type="button" class="option-btn ${isSelected('mode', 'private')}" data-value="private" data-name="mode">Private</button>
                    </div>
                </div>
                
                <div class="setting-group">
                    <label>Sudo Numbers (Maximum 3)</label>
                    <p class="description">Enter up to 3 privileged numbers</p>
                    <input type="text" name="sudo1" placeholder="Sudo Number 1 (Optional)" value="${cleanSudo[0] || ''}">
                    <input type="text" name="sudo2" placeholder="Sudo Number 2 (Optional)" value="${cleanSudo[1] || ''}">
                    <input type="text" name="sudo3" placeholder="Sudo Number 3 (Optional)" value="${cleanSudo[2] || ''}">
                </div>

                <input type="hidden" name="number" value="${number}">
                <input type="hidden" name="botName" value="${botName}">
                <input type="hidden" name="botVersion" value="${botVersion}">
                <input type="hidden" name="userName" value="${userName}">
                <button type="submit" id="submit-btn">SUBMIT</button>
            </form>
            <p id="message" class="error"></p>
        `;

        // Setting up button selection logic
        document.querySelectorAll('.option-buttons').forEach(group => {
            group.querySelectorAll('.option-btn').forEach(button => {
                button.addEventListener('click', handleOptionClick);
            });
        });

        document.getElementById('settings-form').addEventListener('submit', handleSubmitSettings);
    }
    
    // Mutual Exclusion Logic for Presence settings
    function handleOptionClick(event) {
        const button = event.currentTarget;
        const group = button.closest('.option-buttons');
        const settingName = button.dataset.name;
        const value = button.dataset.value;

        // 1. Standard selection logic
        group.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
        button.classList.add('selected');

        // 2. Mutual exclusion for presence settings
        const presenceSettings = ['autorecordingtyping', 'autoTyping', 'autoRecording'];
        
        if (presenceSettings.includes(settingName) && value === 'true') {
            
            // If any presence setting is set to true, set the other two to false
            presenceSettings
                .filter(name => name !== settingName)
                .forEach(otherName => {
                    const otherGroup = document.querySelector(`.option-buttons[data-setting-name="${otherName}"]`);
                    if (otherGroup) {
                        // Find and select the 'False' button in the other groups
                        otherGroup.querySelectorAll('.option-btn').forEach(otherBtn => {
                            otherBtn.classList.remove('selected');
                            if (otherBtn.dataset.value === 'false') {
                                otherBtn.classList.add('selected');
                            }
                        });
                    }
                });
        }
    }


    async function handleSubmitSettings(event) {
        event.preventDefault();
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        const messageElement = document.getElementById('message');
        messageElement.textContent = '';
        
        // Collect all data from the form
        const settings = {
            number: document.querySelector('input[name="number"]').value,
            botName: document.querySelector('input[name="botName"]').value,
            botVersion: document.querySelector('input[name="botVersion"]').value,
            userName: document.querySelector('input[name="userName"]').value,
            
            prefix: document.getElementById('prefix-input').value,
            sudo1: document.querySelector('input[name="sudo1"]').value,
            sudo2: document.querySelector('input[name="sudo2"]').value,
            sudo3: document.querySelector('input[name="sudo3"]').value,

            // Boolean settings (extracted from selected buttons)
            autoread: document.querySelector('.option-btn[data-name="autoread"].selected').dataset.value,
            autoviewstatus: document.querySelector('.option-btn[data-name="autoviewstatus"].selected').dataset.value,
            autorecordingtyping: document.querySelector('.option-btn[data-name="autorecordingtyping"].selected').dataset.value,
            autoTyping: document.querySelector('.option-btn[data-name="autoTyping"].selected').dataset.value,
            autoRecording: document.querySelector('.option-btn[data-name="autoRecording"].selected').dataset.value,
            antiDelete: document.querySelector('.option-btn[data-name="antiDelete"].selected').dataset.value,
            alwaysOnline: document.querySelector('.option-btn[data-name="alwaysOnline"].selected').dataset.value,
            mode: document.querySelector('.option-btn[data-name="mode"].selected').dataset.value,
        };

        try {
            const response = await fetch('/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            const data = await response.json();

            if (data.success && data.page === 'finish') {
                renderFinishPage(data.botName, data.userName);
            } else {
                messageElement.textContent = data.message || 'Submission failed.';
                submitBtn.disabled = false;
                submitBtn.textContent = 'SUBMIT';
            }
        } catch (error) {
            messageElement.textContent = 'Server error during submission.';
            submitBtn.disabled = false;
            submitBtn.textContent = 'SUBMIT';
        }
    }

    function renderFinishPage(botName, userName) {
        contentArea.innerHTML = `
            <h2 class="finish-title">🎉 Configuration Complete!</h2>
            <h1 class="enjoy-message">ENJOY ${botName} DEAR ${userName}</h1>
            <p class="description">Your bot settings have been saved and your session is now configured. Please check your WhatsApp for a confirmation message.</p>
        `;
    }
});