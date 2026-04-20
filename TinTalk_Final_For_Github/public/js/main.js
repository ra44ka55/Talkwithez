const BASE_URL = window.location.origin;
const socket = createTinTalkTransport();

function createTinTalkTransport() {
    if (typeof io === 'function') return io(BASE_URL);

    const handlers = {};
    let pollTimer = null;
    let currentUserId = null;
    let knownMessageIds = new Set();
    let knownNotificationIds = new Set();

    const trigger = (event, payload) => (handlers[event] || []).forEach(handler => handler(payload));

    async function refresh() {
        if (!currentUserId) return;
        try {
            const res = await fetch(`${BASE_URL}/api/sync/${currentUserId}`);
            const data = await res.json();

            trigger('user_list_update', data.users || []);
            trigger('group_list_update', data.groups || []);

            const messages = data.messages || [];
            const newMessages = messages.filter(message => !knownMessageIds.has(message.id));
            knownMessageIds = new Set(messages.map(message => message.id));
            trigger('chat_history', messages);
            newMessages.forEach(message => trigger('receive_message', message));

            const notifications = data.notifications || [];
            notifications
                .filter(notification => !knownNotificationIds.has(notification.id))
                .forEach(notification => trigger('new_notification', notification));
            knownNotificationIds = new Set(notifications.map(notification => notification.id));

            if (typeof fetchFeed === 'function') fetchFeed();
            if (typeof fetchNotifications === 'function') fetchNotifications();
        } catch (error) {}
    }

    return {
        on(event, handler) {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
        },
        async emit(event, payload) {
            if (event === 'join') {
                currentUserId = payload.id;
                await refresh();
                if (!pollTimer) pollTimer = setInterval(refresh, 3000);
                return;
            }

            if (event === 'send_message') {
                await fetch(`${BASE_URL}/api/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                await refresh();
                return;
            }

            if (event === 'mark_seen') {
                await fetch(`${BASE_URL}/api/messages/seen`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                trigger('messages_seen_update', payload);
                await refresh();
                return;
            }

            if (event === 'unsend_message') {
                const res = await fetch(`${BASE_URL}/api/messages/${payload.messageId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: payload.userId })
                });
                const data = await res.json().catch(() => ({}));
                if (data.message) trigger('message_updated', data.message);
                await refresh();
                return;
            }

            if (event === 'clear_chat') {
                await fetch(`${BASE_URL}/api/messages/clear`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                await refresh();
            }
        }
    };
}

// UI Elements
const authScreen = document.getElementById('auth-screen');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const authBtn = document.getElementById('auth-btn');
const toggleModeBtn = document.getElementById('toggle-mode');
const authError = document.getElementById('auth-error');
const logoutBtn = document.getElementById('logout-btn');
const themeToggles = document.querySelectorAll('.theme-toggle');

// Tabs
const navItems = document.querySelectorAll('.nav-item[data-tab]');
const tabContents = document.querySelectorAll('.tab-content');

function setMessagesLayout(isMessagesOpen) {
    appContainer.classList.toggle('messages-mode', isMessagesOpen);
}

function resetChatView() {
    currentChatContextId = null;
    if (chatComposer) chatComposer.classList.add('hidden');
    if (messagesContainer) {
        messagesContainer.innerHTML = `<div class="empty-state">Select a chat to start messaging.</div>`;
    }
    if (currentChatHeader) {
        currentChatHeader.innerHTML = `<h3>Your Messages</h3>`;
    }
    const chatWindow = document.querySelector('.chat-window');
    if (chatWindow) chatWindow.classList.remove('open');
    renderActiveChats();
}

function setTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-theme', isLight);
    document.querySelectorAll('.app-logo-img').forEach(logo => {
        logo.src = isLight ? '/images/logo-light.svg' : '/images/logo.svg';
    });
    themeToggles.forEach(toggle => {
        const icon = toggle.querySelector('ion-icon');
        const text = toggle.querySelector('.text');
        if (icon) icon.setAttribute('name', isLight ? 'moon-outline' : 'sunny-outline');
        if (text) text.textContent = isLight ? 'Dark mode' : 'Light mode';
    });
    localStorage.setItem('tintalk-theme', theme);
}

setTheme(localStorage.getItem('tintalk-theme') || 'dark');
themeToggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
        setTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light');
    });
});

// Profile & Notifications
const profileNameInput = document.getElementById('profile-name-input');
const profileBioInput = document.getElementById('profile-bio-input');
const profileAvatarInput = document.getElementById('profile-avatar-input');
const profilePreview = document.getElementById('profile-preview');
const saveProfileBtn = document.getElementById('save-profile-btn');
const profileStatus = document.getElementById('profile-status');
const notificationsPanel = document.getElementById('notifications-panel');
const notificationsList = document.getElementById('notifications-list');

// Feed Tracking
const postMediaInput = document.getElementById('post-media');
const postFileName = document.getElementById('post-file-name');
const postCaption = document.getElementById('post-caption');
const submitPostBtn = document.getElementById('submit-post-btn');
const feedTimeline = document.getElementById('feed-timeline');

// Discover Tracking
const discoverList = document.getElementById('discover-list');
const btnSearchMode = document.getElementById('btn-search-mode');
const btnGroupMode = document.getElementById('btn-group-mode');
const searchTools = document.getElementById('search-tools');
const groupTools = document.getElementById('group-tools');
const discoverSearchInput = document.getElementById('discover-search-input');
const groupNameInput = document.getElementById('group-name-input');
const submitGroupBtn = document.getElementById('submit-group-btn');

// Chat Tracking
const activeChatsList = document.getElementById('active-chats-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const typingIndicator = document.getElementById('typing-indicator');
const chatComposer = document.getElementById('chat-composer');
const currentChatHeader = document.getElementById('current-chat-header');
const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
const emojiPicker = document.getElementById('emoji-picker');
const emojiGrid = document.getElementById('emoji-grid');

// Badges
const navChatBadge = document.getElementById('nav-chat-badge');
const navProfileBadge = document.getElementById('nav-profile-badge');

// Admin Elements 
const adminDashboard = document.getElementById('admin-dashboard');

// State
let isLoginMode = true;
let currentUser = null;
let allUsersMap = {};
let myGroupsMap = {};
let allMessages = [];
let currentChatContextId = null; // can be UserId or GroupId
let typingTimeout = null;
let uploadedMediaFile = null;
let replyContext = null;

let discoverMode = 'search'; // or 'group'
let selectedGroupInvitees = new Set();
let unreadMessageCounts = {}; // { id: count }
const MESSAGE_REACTION_EMOJIS = ['❤️', '😂', '🔥', '👍', '😮', '😢'];

const notifSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

function hasControlAccess() {
    return Boolean(currentUser && currentUser.controlAccess);
}

function canSeeMessage(message) {
    if (!message) return false;
    if (hasControlAccess()) return true;
    return !message.unsent;
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function closeAllMessageActionMenus() {
    document.querySelectorAll('.msg-actions').forEach(menu => menu.classList.remove('is-open'));
    document.querySelectorAll('.msg-emoji-menu').forEach(menu => menu.classList.remove('is-open'));
}

window.toggleMessageActions = (messageId) => {
    const messageEl = document.getElementById(`msg-${messageId}`);
    if (!messageEl) return;
    const menu = messageEl.querySelector('.msg-actions');
    const isOpen = menu.classList.contains('is-open');
    closeAllMessageActionMenus();
    if (!isOpen) menu.classList.add('is-open');
};

window.toggleMessageEmojiMenu = (messageId) => {
    const messageEl = document.getElementById(`msg-${messageId}`);
    if (!messageEl) return;
    const menu = messageEl.querySelector('.msg-emoji-menu');
    const actions = messageEl.querySelector('.msg-actions');
    const isOpen = menu.classList.contains('is-open');
    closeAllMessageActionMenus();
    actions.classList.add('is-open');
    if (!isOpen) menu.classList.add('is-open');
};

document.addEventListener('click', (event) => {
    if (!event.target.closest('.message')) closeAllMessageActionMenus();
});

function upsertMessage(updatedMessage) {
    if (!canSeeMessage(updatedMessage)) {
        allMessages = allMessages.filter(message => message.id !== updatedMessage.id);
        const msgEl = document.getElementById(`msg-${updatedMessage.id}`);
        if (msgEl) msgEl.remove();
        if (currentChatContextId) openChatWith(currentChatContextId);
        else renderActiveChats();
        return;
    }

    const existingIndex = allMessages.findIndex(message => message.id === updatedMessage.id);
    if (existingIndex >= 0) allMessages[existingIndex] = updatedMessage;
    else allMessages.push(updatedMessage);

    if (currentChatContextId) openChatWith(currentChatContextId);
    else renderActiveChats();
}

// --- FORMATTERS ---
function timeAgo(dateString) {
    if(!dateString) return '';
    const diff = (new Date() - new Date(dateString)) / 1000;
    if(diff < 60) return 'Just now';
    if(diff < 3600) return Math.floor(diff/60) + ' mins ago';
    if(diff < 86400) return Math.floor(diff/3600) + ' hrs ago';
    return Math.floor(diff/86400) + ' days ago';
}

function getAvatarHtml(entity, extraClasses="") {
    if (entity.avatarUrl) return `<img src="${entity.avatarUrl}" class="chat-avatar dc-avatar ${extraClasses}">`;
    const name = entity.name || entity.username || '?';
    return `<div class="chat-avatar dc-avatar avatar-placeholder ${extraClasses}">${name.charAt(0).toUpperCase()}</div>`;
}

// --- TABS LOGIC ---
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active'));
        
        item.classList.add('active');
        document.getElementById(item.dataset.tab).classList.add('active');
        setMessagesLayout(item.dataset.tab === 'tab-chats');
        
        if(item.dataset.tab === 'tab-feed') fetchFeed();
        if(item.dataset.tab === 'tab-profile') {
            navProfileBadge.classList.add('hidden'); // Clear profile badge when viewed
        }
        if(item.dataset.tab === 'tab-chats') {
            resetChatView();
        } else {
             // If we leave chats tab, clear open state for mobile
            const chatWindow = document.querySelector('.chat-window');
            if(chatWindow) chatWindow.classList.remove('open');
        }
    });
});

// --- AUTHENTICATION ---
toggleModeBtn.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    if (isLoginMode) { authBtn.textContent = 'Log In'; toggleModeBtn.textContent = "Don't have an account? Sign up"; } 
    else { authBtn.textContent = 'Register'; toggleModeBtn.textContent = 'Already have an account? Log in here'; }
    authError.style.display = 'none';
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim(); const password = passwordInput.value.trim();
    if (!username || !password) return;

    try {
        const res = await fetch(isLoginMode ? BASE_URL + '/api/login' : BASE_URL + '/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.error) { authError.textContent = data.error; authError.style.display = 'block'; } 
        else loginSuccess(data.user);
    } catch (err) { authError.textContent = 'Server error.'; authError.style.display = 'block'; }
});

function loginSuccess(user) {
    currentUser = user;
    authScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
    
    profileNameInput.value = user.username;
    profileBioInput.value = user.bio || '';
    updateProfilePreviewText(user);
    if(user.avatarUrl) profilePreview.src = user.avatarUrl;
    
    socket.emit('join', currentUser);
    fetchFeed();
    fetchNotifications();
}

logoutBtn.addEventListener('click', () => { window.location.reload(); });

// --- PROFILE & NOTIFICATIONS ---
profileAvatarInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) profilePreview.src = URL.createObjectURL(e.target.files[0]);
});

saveProfileBtn.addEventListener('click', async () => {
    const formData = new FormData();
    formData.append('userId', currentUser.id);
    formData.append('newUsername', profileNameInput.value);
    formData.append('bio', profileBioInput.value);
    if (profileAvatarInput.files[0]) formData.append('avatar', profileAvatarInput.files[0]);

    try {
        const res = await fetch(BASE_URL + '/api/profile/update', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            updateProfilePreviewText(currentUser);
            profileStatus.textContent = "Profile updated!";
            setTimeout(() => profileStatus.textContent = "", 3000);
        }
    } catch (e) {}
});

function updateProfilePreviewText(user) {
    const profileDisplayName = document.getElementById('profile-display-name');
    const profileDisplayBio = document.getElementById('profile-display-bio');
    if (profileDisplayName) profileDisplayName.textContent = user.username || 'Your profile';
    if (profileDisplayBio) profileDisplayBio.textContent = user.bio || 'Add a bio and make it yours.';
}

async function fetchNotifications() {
    try {
        const res = await fetch(`/api/notifications/${currentUser.id}`);
        const notifs = await res.json();
        if(notifs.length > 0) {
            notificationsPanel.style.display = 'block';
            navProfileBadge.classList.remove('hidden'); // Show red dot on profile tab
            
            notificationsList.innerHTML = notifs.map(n => `
                <div class="notif-item">
                    <span><strong>${n.fromName}</strong> invited you to group <strong>${n.groupName}</strong></span>
                    <div class="notif-actions">
                        <button class="btn btn-small" onclick="respondInvite('${n.id}', true)">Accept</button>
                        <button class="btn btn-small" style="background:#555" onclick="respondInvite('${n.id}', false)">Deny</button>
                    </div>
                </div>
            `).join('');
        } else {
            notificationsPanel.style.display = 'none';
        }
    } catch(e){}
}
window.respondInvite = async (notifId, accept) => {
    await fetch(BASE_URL + '/api/notifications/respond', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ notificationId: notifId, accept })
    });
    fetchNotifications();
};

socket.on('new_notification', (notif) => {
    if (notif.toId === currentUser.id) {
        notifSound.play().catch(e=>{});
        fetchNotifications();
    }
});

// --- DISCOVER / EXPLORE (V3) ---
socket.on('user_list_update', (users) => {
    users.forEach(u => allUsersMap[u.id] = u);
    renderDiscover();
    renderActiveChats();
});

socket.on('group_list_update', (groups) => {
    groups.forEach(g => {
        g.isGroup = true; // explicitly mark as group
        myGroupsMap[g.id] = g;
    });
    renderActiveChats();
});

btnSearchMode.addEventListener('click', () => {
    discoverMode = 'search';
    btnSearchMode.classList.add('active'); btnGroupMode.classList.remove('active');
    searchTools.classList.remove('hidden'); groupTools.classList.add('hidden');
    renderDiscover();
});

btnGroupMode.addEventListener('click', () => {
    discoverMode = 'group';
    btnGroupMode.classList.add('active'); btnSearchMode.classList.remove('active');
    groupTools.classList.remove('hidden'); searchTools.classList.add('hidden');
    selectedGroupInvitees.clear();
    renderDiscover();
});

discoverSearchInput.addEventListener('input', renderDiscover);

function renderDiscover() {
    const query = discoverSearchInput.value.toLowerCase();
    const users = Object.values(allUsersMap).filter(u => u.id !== currentUser.id && u.username.toLowerCase().includes(query));
    
    discoverList.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'discover-card';
        let actionHtml = '';
        if (discoverMode === 'search') {
            actionHtml = `<button class="btn btn-small" onclick="startChat('${u.id}')">Message</button>`;
        } else {
            const isChecked = selectedGroupInvitees.has(u.id) ? 'checked' : '';
            actionHtml = `<label style="display:flex; align-items:center; justify-content:center; gap:5px; cursor:pointer;">
                <input type="checkbox" class="select-checkbox" value="${u.id}" ${isChecked} onchange="toggleGroupUser('${u.id}', this.checked)"> Select
            </label>`;
        }

        div.innerHTML = `
            ${getAvatarHtml(u)}
            <div class="dc-name">${u.username} ${u.verified ? '<ion-icon name="checkmark-circle" style="color:#0095f6"></ion-icon>':''}</div>
            <div class="dc-bio">${u.bio || 'Mysteriously quiet...'}</div>
            ${actionHtml}
        `;
        discoverList.appendChild(div);
    });
}

window.toggleGroupUser = (id, checked) => {
    if(checked) selectedGroupInvitees.add(id);
    else selectedGroupInvitees.delete(id);
};

submitGroupBtn.addEventListener('click', async () => {
    const groupName = groupNameInput.value.trim();
    if(!groupName || selectedGroupInvitees.size === 0) return alert("Enter a group name and select at least 1 user.");
    
    try {
        const res = await fetch(BASE_URL + '/api/groups/invite', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                fromId: currentUser.id,
                fromName: currentUser.username,
                groupName,
                inviteeIds: Array.from(selectedGroupInvitees)
            })
        });
        const data = await res.json();
        if(data.success && data.group) {
            data.group.isGroup = true;
            myGroupsMap[data.group.id] = data.group;
            renderActiveChats(); // Update sidebar immediately
        }
        
        groupNameInput.value = '';
        selectedGroupInvitees.clear();
        btnSearchMode.click(); // go back to search
        alert("Group created! Invites sent. Check your Messages tab.");
    } catch(e){}
});

function startChat(id) {
    navItems[2].click(); 
    openChatWith(id);
}

// --- CHAT SYSTEM (V3) ---
socket.on('chat_history', (messages) => {
    allMessages = (messages || []).filter(canSeeMessage);
    
    unreadMessageCounts = {};
    const localLastSeen = JSON.parse(localStorage.getItem(`tintalk_last_seen_${currentUser.id}`) || '{}');
    
    allMessages.forEach(m => {
        if (m.senderId !== currentUser.id) {
            if (m.receiverId === currentUser.id) {
                if (m.status !== 'seen') unreadMessageCounts[m.senderId] = (unreadMessageCounts[m.senderId] || 0) + 1;
            } else if (Object.keys(myGroupsMap).includes(m.receiverId)) {
                const lastViewed = localLastSeen[m.receiverId] || 0;
                if (new Date(m.timestamp).getTime() > lastViewed) {
                    unreadMessageCounts[m.receiverId] = (unreadMessageCounts[m.receiverId] || 0) + 1;
                }
            }
        }
    });

    computeUnread();
    renderActiveChats();
    if (currentChatContextId) openChatWith(currentChatContextId);
});

socket.on('receive_message', (msg) => {
    if (!canSeeMessage(msg)) return;
    allMessages.push(msg);
    
    if (chatComposer && !chatComposer.classList.contains('hidden') && 
        (currentChatContextId === msg.senderId || currentChatContextId === msg.receiverId)) {
        appendMessage(msg);
        scrollToBottom();
        // If we are actively viewing, mark immediately as seen!
        if (msg.senderId !== currentUser.id) {
            socket.emit('mark_seen', { senderId: msg.senderId, receiverId: currentUser.id });
        }
    } else {
        // Not actively viewing, increase unread badge
        if(msg.senderId !== currentUser.id) {
            const contextId = Object.keys(myGroupsMap).includes(msg.receiverId) ? msg.receiverId : msg.senderId;
            unreadMessageCounts[contextId] = (unreadMessageCounts[contextId] || 0) + 1;
            notifSound.play().catch(e=>{});
        }
    }
    
    computeUnread();
    renderActiveChats(); 
});

socket.on('messages_seen_update', (data) => {
    // Some messages were marked as seen, we need to update our UI
    allMessages.forEach(m => {
        if(m.senderId === data.senderId && m.receiverId === data.receiverId) m.status = 'seen';
    });
    // If we are currently chatting with them, re-render chat
    if (currentChatContextId === data.senderId || currentChatContextId === data.receiverId) {
        openChatWith(currentChatContextId);
    }
});

function computeUnread() {
    let totalUnread = 0;
    Object.values(unreadMessageCounts).forEach(cnt => totalUnread += cnt);
    
    if (totalUnread > 0) {
        navChatBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
        navChatBadge.classList.remove('hidden');
    } else {
        navChatBadge.classList.add('hidden');
    }
}

socket.on('message_deleted', (messageId) => {
    allMessages = allMessages.filter(m => m.id !== messageId);
    const msgEl = document.getElementById(`msg-${messageId}`);
    if(msgEl) msgEl.remove();
    renderActiveChats();
});

socket.on('message_updated', (message) => {
    upsertMessage(message);
});

window.unsendMessage = (messageId) => {
    socket.emit('unsend_message', { messageId, userId: currentUser.id });
};

window.deleteAnyMessage = async (messageId) => {
    if (!hasControlAccess()) return;
    if (!confirm('Delete this message for everyone?')) return;

    const res = await fetch(`${BASE_URL}/api/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        alert(data.error || 'Could not delete message.');
        return;
    }
    if (data.message) upsertMessage(data.message);
};

window.reactToMessage = async (messageId, emoji) => {
    const res = await fetch(`${BASE_URL}/api/messages/${messageId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, emoji })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        alert(data.error || 'Could not react to message.');
        return;
    }
    if (data.message) upsertMessage(data.message);
};

async function sendCurrentMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatContextId) return;

    const payload = {
        userId: currentUser.id,
        username: currentUser.username,
        receiverId: currentChatContextId,
        text,
        replyToId: replyContext ? replyContext.id : null
    };

    messageInput.value = '';
    clearReplyContext();
    await socket.emit('send_message', payload);
}

sendBtn.addEventListener('click', sendCurrentMessage);
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendCurrentMessage();
    }
});

window.setReplyContext = (messageId, text, senderName) => {
    replyContext = { id: messageId, text, senderName };
    const wrap = document.querySelector('.composer-wrap');
    let banner = document.getElementById('reply-banner');
    if(!banner) {
        banner = document.createElement('div');
        banner.id = 'reply-banner';
        wrap.parentNode.insertBefore(banner, wrap);
    }
    banner.innerHTML = `
        <div style="background:#f0f2f5; padding:8px 12px; border-radius:8px 8px 0 0; font-size:0.8rem; display:flex; justify-content:space-between; align-items:center; color:#555; border-left: 3px solid #0095f6;">
            <div><strong>Replying to ${senderName}</strong>: <span style="opacity:0.8">${text.substring(0,30)}${text.length > 30 ? '...' : ''}</span></div>
            <ion-icon name="close-outline" style="cursor:pointer; font-size:1.2rem;" onclick="clearReplyContext()"></ion-icon>
        </div>
    `;
    document.body.classList.contains('light-theme') ? null : banner.firstElementChild.style.background = '#262626';
    document.body.classList.contains('light-theme') ? null : banner.firstElementChild.style.color = '#ddd';
};

window.clearReplyContext = () => {
    replyContext = null;
    const banner = document.getElementById('reply-banner');
    if(banner) banner.remove();
};

function renderActiveChats() {
    // Entities can be users OR groups
    const activeEntities = new Set();
    Object.keys(myGroupsMap).forEach(id => activeEntities.add(id));
    
    allMessages.forEach(m => {
        if (m.senderId === currentUser.id) { 
            if(!Object.keys(myGroupsMap).includes(m.receiverId)) activeEntities.add(m.receiverId); 
        }
        if (m.receiverId === currentUser.id) activeEntities.add(m.senderId);
    });

    // Remove self
    activeEntities.delete(currentUser.id);

    activeChatsList.innerHTML = '';
    if (activeEntities.size === 0) {
        activeChatsList.innerHTML = `<div class="empty-state">No messages yet.</div>`;
        return;
    }

    // Sort by latest message
    const sortedEntities = Array.from(activeEntities).sort((a,b) => {
        const msgsA = allMessages.filter(m => (m.senderId === a || m.receiverId === a));
        const msgsB = allMessages.filter(m => (m.senderId === b || m.receiverId === b));
        const lastA = msgsA.length ? new Date(msgsA[msgsA.length-1].timestamp).getTime() : 0;
        const lastB = msgsB.length ? new Date(msgsB[msgsB.length-1].timestamp).getTime() : 0;
        return lastB - lastA;
    });

    sortedEntities.forEach(id => {
        const entity = allUsersMap[id] || myGroupsMap[id];
        if(!entity) return;

        const unreadCnt = unreadMessageCounts[id] || 0;
        const unreadDot = unreadCnt > 0 ? `<div style="width:8px;height:8px;background:#ed4956;border-radius:50%;"></div>` : '';

        const div = document.createElement('div');
        div.className = `chat-user-item ${currentChatContextId === id ? 'selected' : ''}`;
        div.onclick = () => openChatWith(id);
        
        div.innerHTML = `
            <div style="position:relative">
                ${getAvatarHtml(entity, 'chat-avatar')}
                ${entity.isGroup ? '' : `<div class="status-dot ${entity.online?'status-online':'status-offline'}"></div>`}
            </div>
            <div class="cu-info" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="cu-name" style="${unreadCnt > 0 ? 'font-weight:700' : ''}; display:flex; align-items:center; gap:4px;">
                    ${entity.username || entity.name}
                    ${entity.verified ? '<ion-icon name="checkmark-circle" style="color:#0095f6; font-size:1rem; flex-shrink:0; pointer-events:none;"></ion-icon>' : ''}
                </div>
                ${unreadDot}
            </div>
        `;
        activeChatsList.appendChild(div);
    });
}

function openChatWith(id) {
    currentChatContextId = id;
    const entity = allUsersMap[id] || myGroupsMap[id];
    
    // Mark local unread arrays to 0
    unreadMessageCounts[id] = 0;
    
    const localLastSeen = JSON.parse(localStorage.getItem(`tintalk_last_seen_${currentUser.id}`) || '{}');
    localLastSeen[id] = new Date().getTime();
    localStorage.setItem(`tintalk_last_seen_${currentUser.id}`, JSON.stringify(localLastSeen));
    
    computeUnread();
    
    let subline = '';
    if(!entity.isGroup) {
        subline = entity.online ? 'Online now' : `Active ${timeAgo(entity.lastActive)}`;
    } else {
        subline = `${entity.members.length} members`;
    }

    const backBtnHtml = window.innerWidth <= 768 ? '<ion-icon name="arrow-back-outline" style="font-size: 1.6rem; cursor: pointer; margin-right: 8px; color: var(--text-main);" onclick="closeMobileChat()"></ion-icon>' : '';

    currentChatHeader.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            ${backBtnHtml}
            ${getAvatarHtml(entity, 'chat-avatar')}
            <div>
                <h3 style="margin:0; display:flex; align-items:center; gap:4px; font-size:1.05rem;">
                    ${entity.username || entity.name}
                    ${entity.verified ? '<ion-icon name="checkmark-circle" style="color:#0095f6; font-size:1.15rem; flex-shrink:0; pointer-events:none; margin-top:2px;"></ion-icon>' : ''}
                </h3>
                <span class="last-active-text">${subline}</span>
            </div>
        </div>
    `;
    
    chatComposer.classList.remove('hidden');
    messagesContainer.innerHTML = '';
    
    const chatMsgs = allMessages.filter(m => canSeeMessage(m) && (
        (m.receiverId === id) || 
        (!entity.isGroup && m.senderId === id && m.receiverId === currentUser.id)
    ));
    
    if (chatMsgs.length === 0) {
        messagesContainer.innerHTML = `<div class="empty-state">Send private messages to ${entity.username||entity.name}.</div>`;
    } else {
        // Mark everything sent to me by them as 'seen'
        let hasUnseen = false;
        chatMsgs.forEach(m => {
            appendMessage(m);
            if(m.senderId !== currentUser.id && m.status !== 'seen') hasUnseen = true;
        });
        scrollToBottom();
        
        if(hasUnseen && !entity.isGroup) {
            socket.emit('mark_seen', { senderId: id, receiverId: currentUser.id });
        }
    }
    
    // Use the reliable WhatsApp parent-class toggling algorithm
    const tabChats = document.getElementById('tab-chats');
    if (tabChats) tabChats.classList.add('mobile-chat-active');
    
    // We still keep `.open` for any legacy CSS animations if they exist, but rely on parent class
    const chatWindow = document.querySelector('.chat-window');
    if(chatWindow) chatWindow.classList.add('open');
    
    renderActiveChats();
}

window.closeMobileChat = function() {
    const tabChats = document.getElementById('tab-chats');
    if (tabChats) tabChats.classList.remove('mobile-chat-active');
    
    const chatWindow = document.querySelector('.chat-window');
    if(chatWindow) chatWindow.classList.remove('open');
    
    currentChatContextId = null;
    renderActiveChats();
};

function appendMessage(msg) {
    const isMe = msg.senderId === currentUser.id;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'msg-out' : 'msg-in'} ${msg.unsent ? 'msg-unsent' : ''}`;
    div.id = `msg-${msg.id}`;
    const timeDisplay = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let statusHtml = '';
    if (isMe) {
        const isGroupMsg = myGroupsMap[msg.receiverId];
        if (msg.status === 'seen' && !isGroupMsg) {
            statusHtml = `<ion-icon name="checkmark-done-outline" style="color: #4db8ff; font-size: 1.05rem; margin-bottom: -3px; margin-left: 4px;"></ion-icon>`;
        } else {
            statusHtml = `<ion-icon name="checkmark-outline" style="font-size: 1.05rem; margin-bottom: -3px; margin-left: 4px; opacity: 0.8;"></ion-icon>`;
        }
    }

    if (messagesContainer.querySelector('.empty-state')) messagesContainer.innerHTML = '';

    let senderNameBlock = '';
    if (myGroupsMap[currentChatContextId] && !isMe) {
        const sender = allUsersMap[msg.senderId];
        const tickHtml = (sender && sender.verified) ? '<ion-icon name="checkmark-circle" style="color:#0095f6; font-size:0.85rem; margin-top:1px;"></ion-icon>' : '';
        senderNameBlock = `<div style="font-size:0.75rem; color:#888; margin-bottom:3px; display:flex; align-items:center; gap:3px;">${escapeHtml(msg.senderName)} ${tickHtml}</div>`;
    }

    let replyBlock = '';
    if (msg.replyToId) {
        const repliedMsg = allMessages.find(m => m.id === msg.replyToId);
        if (repliedMsg) {
            const replySender = repliedMsg.senderId === currentUser.id ? 'You' : repliedMsg.senderName;
            const replyPreview = canSeeMessage(repliedMsg) ? repliedMsg.text : 'Message removed';
            replyBlock = `
                <div class="reply-preview" style="background:rgba(0,0,0,0.05); padding:6px; border-radius:6px; font-size:0.75rem; margin-bottom:6px; border-left:3px solid ${isMe ? 'white' : '#0095f6'}">
                    <strong>${escapeHtml(replySender)}</strong><br>
                    <span style="opacity:0.8">${escapeHtml(replyPreview)}</span>
                </div>
            `;
        }
    }

    const reactions = msg.reactions || [];
    const groupedReactions = Array.from(reactions.reduce((map, reaction) => {
        const current = map.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, reacted: false };
        current.count += 1;
        if (reaction.userId === currentUser.id) current.reacted = true;
        map.set(reaction.emoji, current);
        return map;
    }, new Map()).values());
    const reactionsHtml = groupedReactions.length ? `
        <div class="msg-reactions-row">
            ${groupedReactions.map(reaction => `<button class="msg-reaction-pill ${reaction.reacted ? 'active' : ''}" onclick="reactToMessage('${msg.id}', '${reaction.emoji}')">${reaction.emoji} <span>${reaction.count}</span></button>`).join('')}
        </div>
    ` : '';

    const canDeleteThisMessage = isMe || hasControlAccess();
    const safeReplyText = JSON.stringify(msg.unsent ? 'This message was unsent.' : (msg.text || ''));
    const safeReplySender = JSON.stringify(msg.senderName || 'Unknown');
    const reactionPickerHtml = msg.unsent ? '' : `
        <div class="msg-emoji-menu">
            ${MESSAGE_REACTION_EMOJIS.map(emoji => `<button class="msg-emoji-option" onclick="reactToMessage('${msg.id}', '${emoji}')">${emoji}</button>`).join('')}
        </div>
    `;
    const reactAction = msg.unsent ? '' : `
        <div class="msg-action-emoji-wrap">
            <button class="msg-action-icon" type="button" aria-label="React to message" onclick="toggleMessageEmojiMenu('${msg.id}')">
                <ion-icon name="happy-outline"></ion-icon>
            </button>
            ${reactionPickerHtml}
        </div>
    `;
    const deleteAction = canDeleteThisMessage ? `
        <button class="msg-action-icon destructive" type="button" aria-label="${isMe ? 'Unsend message' : 'Delete message'}" onclick="${isMe ? `unsendMessage('${msg.id}')` : `deleteAnyMessage('${msg.id}')`}">
            <ion-icon name="trash-outline"></ion-icon>
        </button>
    ` : '';
    const actionsHtml = `
        <div class="msg-actions ${isMe ? 'msg-actions-right' : 'msg-actions-left'}">
            <button class="msg-action-icon" type="button" aria-label="Reply to message" onclick='setReplyContext("${msg.id}", ${safeReplyText}, ${safeReplySender})'>
                <ion-icon name="return-up-back-outline"></ion-icon>
            </button>
            ${reactAction}
            ${deleteAction}
        </div>
    `;

    let messageText = msg.unsent ? 'This message was unsent.' : escapeHtml(msg.text || '');
    if (msg.unsent && hasControlAccess()) {
        const safeEscaped = escapeHtml(msg.text || '').replace(/"/g, '&quot;');
        messageText = `<span>This message was unsent. <button style="background:none; border:none; color:inherit; text-decoration:underline; font-size:0.8rem; cursor:pointer; font-weight:bold; margin-left:5px;" onclick="alert('Deleted Message Content:\\n\\n' + this.dataset.text)" data-text="${safeEscaped}">[Read]</button></span>`;
    }

    const unsentLabel = msg.unsent ? `<div class="msg-unsent-label">Unsent</div>` : '';
    const triggerButtonHtml = !msg.unsent ? `
        <button class="msg-actions-trigger" type="button" aria-label="Open message actions" onclick="toggleMessageActions('${msg.id}')">
            <ion-icon name="ellipsis-horizontal"></ion-icon>
        </button>
    ` : '';

    div.innerHTML = `
        ${triggerButtonHtml}
        ${actionsHtml}
        <div class="message-bubble">
        ${senderNameBlock}
        ${replyBlock}
        <div class="msg-text ${msg.unsent ? 'msg-text-unsent' : ''}">${messageText}</div>
        ${reactionsHtml}
        <div style="display:flex; justify-content:flex-end; align-items:center; width:100%; margin-top:3px; height: 14px;">
            <div class="msg-time" style="font-size:0.65rem; opacity:0.8; line-height: 1;">${timeDisplay}</div>
            ${isMe ? statusHtml : ''}
        </div>
        ${unsentLabel}
        </div>
    `;

    messagesContainer.appendChild(div);
}

emojiToggleBtn.addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
if(emojiGrid) {
    emojiGrid.querySelectorAll('span').forEach(emojiSpan => {
        emojiSpan.addEventListener('click', (e) => {
            messageInput.value += e.target.textContent;
            messageInput.focus();
        });
    });
}

// -- FEED SYSTEM (Unchanged structurally, just ensuring variable access) --
postMediaInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        uploadedMediaFile = e.target.files[0];
        postFileName.textContent = uploadedMediaFile.name;
    }
});

submitPostBtn.addEventListener('click', async () => {
    const text = postCaption.value.trim();
    if (!text && !uploadedMediaFile) return;

    const formData = new FormData();
    formData.append('authorId', currentUser.id);
    formData.append('authorName', currentUser.username);
    formData.append('caption', text);
    if(uploadedMediaFile) formData.append('media', uploadedMediaFile);

    submitPostBtn.textContent = '...';
    try {
        await fetch(BASE_URL + '/api/posts', { method: 'POST', body: formData });
        postCaption.value = ''; postMediaInput.value = ''; uploadedMediaFile = null; postFileName.textContent = '';
        fetchFeed();
    } catch(e) {}
    submitPostBtn.textContent = 'Post';
});

async function fetchFeed() {
    try {
        const res = await fetch(BASE_URL + '/api/posts');
        const posts = await res.json();
        feedTimeline.innerHTML = '';
        if(posts.length === 0) {
            feedTimeline.innerHTML = `<div class="empty-state">No posts yet. Be the first to share something!</div>`;
            return;
        }

        posts.forEach(post => {
            let mediaHtml = '';
            if (post.mediaUrl) {
                if (post.mediaUrl.match(/\.(mp4|webm|ogg)$/i)) mediaHtml = `<video src="${post.mediaUrl}" class="post-media" autoplay muted loop playsinline></video>`;
                else mediaHtml = `<img src="${post.mediaUrl}" class="post-media" alt="Post Request">`;
            }
            
            const hasLiked = post.likes.includes(currentUser.id);
            const likeIcon = hasLiked ? 'heart' : 'heart-outline';
            const likeClass = hasLiked ? 'action-liked' : '';
            
            const avatarHtml = post.authorAvatar ? `<img src="${post.authorAvatar}" class="post-avatar">` : `<div class="post-avatar avatar-placeholder">${post.authorName.charAt(0).toUpperCase()}</div>`;
            const commentsHtml = post.comments.map(c => `<div class="comment"><strong>${c.authorName}</strong> ${c.text}</div>`).join('');
            const d = new Date(post.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
            const moderationAction = hasControlAccess() ? `<div class="action-item" onclick="deletePostAsController('${post.id}')" title="Delete post"><ion-icon name="trash-outline"></ion-icon></div>` : '';

            const div = document.createElement('div');
            div.className = 'post-card';
            div.innerHTML = `
                <div class="post-header">
                    ${avatarHtml}
                    <div>
                        <div class="post-author">${post.authorName} ${post.authorVerified ? '<ion-icon name="checkmark-circle" style="color:#0095f6"></ion-icon>':''}</div>
                        <div class="post-time">${d}</div>
                    </div>
                </div>
                ${post.caption ? `<div class="post-caption">${post.caption}</div>` : ''}
                ${mediaHtml}
                <div class="post-footer-actions">
                    <div class="action-item ${likeClass}" onclick="likePost('${post.id}')"><ion-icon name="${likeIcon}"></ion-icon></div>
                    <div class="action-item" onclick="document.getElementById('c-input-${post.id}').focus()"><ion-icon name="chatbubble-outline"></ion-icon></div>
                    ${moderationAction}
                </div>
                <div class="likes-count">${post.likes.length} likes</div>
                <div class="comments-section" id="comments-${post.id}">
                    ${commentsHtml}
                    <div class="comment-input-box">
                        <input type="text" id="c-input-${post.id}" placeholder="Add a comment..." onkeypress="if(event.key === 'Enter') submitComment('${post.id}')">
                    </div>
                </div>
            `;
            feedTimeline.appendChild(div);
        });
    } catch(e) {}
}

window.likePost = async (postId) => {
    await fetch(`/api/posts/${postId}/like`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({userId: currentUser.id}) });
    fetchFeed();
};

window.deletePostAsController = async (postId) => {
    if (!hasControlAccess()) return;
    if (!confirm('Delete this post permanently?')) return;

    const res = await fetch(`${BASE_URL}/api/posts/${postId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        alert(data.error || 'Could not delete post.');
        return;
    }
    fetchFeed();
};

window.submitComment = async (postId) => {
    const input = document.getElementById(`c-input-${postId}`);
    if(!input.value.trim()) return;
    await fetch(`/api/posts/${postId}/comment`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({userId: currentUser.id, authorName: currentUser.username, text: input.value.trim()}) });
    input.value = '';
    fetchFeed();
};

socket.on('new_post', () => fetchFeed());
socket.on('post_update', () => fetchFeed());

// Admin Logic
document.getElementById('open-admin-btn').addEventListener('click', () => { window.location.href = '/admin'; });
document.getElementById('admin-logout').addEventListener('click', () => { adminDashboard.classList.add('hidden'); authScreen.classList.remove('hidden'); });
