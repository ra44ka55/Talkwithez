const loginCard = document.getElementById('login-card');
const dashboard = document.getElementById('dashboard');
const passwordInput = document.getElementById('admin-password');
const loginButton = document.getElementById('admin-login');
const logoutButton = document.getElementById('logout-admin');
const refreshButton = document.getElementById('refresh-dashboard');
const loginError = document.getElementById('login-error');

const stats = {
    users: document.getElementById('stat-users'),
    verified: document.getElementById('stat-verified'),
    groups: document.getElementById('stat-groups'),
    posts: document.getElementById('stat-posts')
};

const usersTable = document.getElementById('users-table');
const groupsList = document.getElementById('groups-list');
const postsList = document.getElementById('posts-list');

let adminPassword = sessionStorage.getItem('tintalk_admin_password') || '';

function createCell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

function formatDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function emptyBlock(message) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = message;
    return div;
}

async function adminFetch(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-admin-password': adminPassword,
            ...(options.headers || {})
        }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Admin request failed');
    return data;
}

async function login() {
    loginError.textContent = '';
    const password = passwordInput.value.trim();
    if (!password) {
        loginError.textContent = 'Password required.';
        return;
    }

    try {
        const res = await fetch('/api/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Invalid admin password');

        adminPassword = password;
        sessionStorage.setItem('tintalk_admin_password', password);
        loginCard.classList.add('hidden');
        dashboard.classList.remove('hidden');
        await loadDashboard();
    } catch (error) {
        loginError.textContent = error.message;
    }
}

async function loadDashboard() {
    const data = await adminFetch('/api/admin/dashboard');
    stats.users.textContent = data.stats.users;
    stats.verified.textContent = data.stats.verifiedUsers;
    stats.groups.textContent = data.stats.groups;
    stats.posts.textContent = data.stats.posts;

    renderUsers(data.users);
    renderGroups(data.groups);
    renderPosts(data.posts);
}

function renderUsers(users) {
    usersTable.innerHTML = '';
    if (!users.length) {
        const row = document.createElement('tr');
        const cell = createCell('No users found.');
        cell.colSpan = 6;
        row.appendChild(cell);
        usersTable.appendChild(row);
        return;
    }

    users.forEach(user => {
        const row = document.createElement('tr');
        row.appendChild(createCell(user.username));

        const passwordCell = document.createElement('td');
        const password = document.createElement('span');
        password.className = 'password-pill';
        password.title = user.rawPassword || 'No raw password stored';
        password.textContent = user.rawPassword || 'Not stored';
        passwordCell.appendChild(password);
        row.appendChild(passwordCell);

        const statusCell = document.createElement('td');
        const status = document.createElement('span');
        status.className = 'status';
        const dot = document.createElement('span');
        dot.className = user.online ? 'dot online' : 'dot';
        const text = document.createElement('span');
        text.textContent = user.online ? 'Online' : 'Offline';
        status.append(dot, text);
        statusCell.appendChild(status);
        row.appendChild(statusCell);

        row.appendChild(createCell(user.verified ? 'Verified' : 'Normal'));
        row.appendChild(createCell(formatDate(user.lastActive)));

        const actions = document.createElement('td');
        const wrap = document.createElement('div');
        wrap.className = 'actions';

        const verifyButton = document.createElement('button');
        verifyButton.className = user.verified ? 'mini-button unverify' : 'mini-button verify';
        verifyButton.textContent = user.verified ? 'Remove Tick' : 'Blue Tick';
        verifyButton.addEventListener('click', () => toggleVerify(user.id, !user.verified));

        const controlButton = document.createElement('button');
        controlButton.className = user.controlAccess ? 'mini-button verify' : 'mini-button';
        controlButton.textContent = user.controlAccess ? 'Control On' : 'Control Off';
        controlButton.title = 'Hidden moderation access. No visible badge is shown in the app.';
        controlButton.addEventListener('click', () => toggleControlAccess(user.id, !user.controlAccess));

        const passButton = document.createElement('button');
        passButton.className = 'mini-button verify';
        passButton.textContent = 'Set Pass';
        passButton.addEventListener('click', () => changeUserPassword(user.id, user.username));

        const deleteButton = document.createElement('button');
        deleteButton.className = 'mini-button danger-button';
        deleteButton.textContent = 'Delete User';
        deleteButton.addEventListener('click', () => deleteUser(user.id, user.username));

        wrap.append(passButton, verifyButton, controlButton, deleteButton);
        actions.appendChild(wrap);
        row.appendChild(actions);

        usersTable.appendChild(row);
    });
}

function renderGroups(groups) {
    groupsList.innerHTML = '';
    if (!groups.length) {
        groupsList.appendChild(emptyBlock('No groups created yet.'));
        return;
    }

    groups.forEach(group => {
        const card = document.createElement('article');
        card.className = 'group-card';
        const title = document.createElement('h3');
        title.textContent = group.name || 'Unnamed group';
        
        const created = document.createElement('p');
        created.className = 'meta';
        created.textContent = `Created: ${formatDate(group.timestamp)}`;
        
        const memberList = document.createElement('ul');
        memberList.className = 'group-members-list';
        memberList.style.listStyleType = 'none';
        memberList.style.padding = '0';
        memberList.style.margin = '10px 0';
        
        (group.members || []).forEach((memberId, idx) => {
            const memberName = (group.memberNames && group.memberNames[idx]) ? group.memberNames[idx] : 'Unknown';
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '4px 0';
            li.style.borderBottom = '1px solid #333';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = memberName;
            
            const kickBtn = document.createElement('button');
            kickBtn.className = 'mini-button danger-button';
            kickBtn.textContent = 'Kick';
            kickBtn.style.padding = '2px 8px';
            kickBtn.addEventListener('click', () => kickMember(group.id, memberId, memberName));
            
            li.append(nameSpan, kickBtn);
            memberList.appendChild(li);
        });

        const actionsDiv = document.createElement('div');
        actionsDiv.style.marginTop = '15px';
        const deleteGroupBtn = document.createElement('button');
        deleteGroupBtn.className = 'mini-button danger-button';
        deleteGroupBtn.textContent = 'Terminate Group';
        deleteGroupBtn.style.width = '100%';
        deleteGroupBtn.addEventListener('click', () => deleteGroup(group.id, group.name));
        actionsDiv.appendChild(deleteGroupBtn);
        
        card.append(title, created, memberList, actionsDiv);
        groupsList.appendChild(card);
    });
}

function renderPosts(posts) {
    postsList.innerHTML = '';
    if (!posts.length) {
        postsList.appendChild(emptyBlock('No posts in feed yet.'));
        return;
    }

    posts.forEach(post => {
        const card = document.createElement('article');
        card.className = 'post-card';

        const body = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = post.authorName;
        const meta = document.createElement('p');
        meta.className = 'meta';
        meta.textContent = `${formatDate(post.timestamp)} · ${post.likesCount} likes · ${post.commentsCount} comments`;
        const caption = document.createElement('p');
        caption.className = 'post-caption';
        caption.textContent = post.caption || 'No caption';
        body.append(title, meta, caption);

        if (post.mediaUrl) {
            const media = document.createElement('a');
            media.className = 'post-media';
            media.href = post.mediaUrl;
            media.target = '_blank';
            media.rel = 'noreferrer';
            media.textContent = 'Open media';
            body.appendChild(media);
        }

        const actions = document.createElement('div');
        const deleteButton = document.createElement('button');
        deleteButton.className = 'mini-button danger-button';
        deleteButton.textContent = 'Delete Post';
        deleteButton.addEventListener('click', () => deletePost(post.id));
        actions.appendChild(deleteButton);

        card.append(body, actions);
        postsList.appendChild(card);
    });
}

async function toggleVerify(userId, verified) {
    await adminFetch(`/api/admin/users/${userId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ verified })
    });
    await loadDashboard();
}

async function toggleControlAccess(userId, controlAccess) {
    await adminFetch(`/api/admin/users/${userId}/control-access`, {
        method: 'PATCH',
        body: JSON.stringify({ controlAccess })
    });
    await loadDashboard();
}

async function changeUserPassword(userId, username) {
    const newPass = prompt(`Enter a new password for user '${username}':`);
    if (!newPass) return;
    if (newPass.length < 3) return alert('Password must be at least 3 characters.');
    
    try {
        await adminFetch(`/api/admin/users/${userId}/password`, {
            method: 'PATCH',
            body: JSON.stringify({ newPassword: newPass })
        });
        alert('Password changed successfully!');
        await loadDashboard();
    } catch (e) {
        alert('Failed to change password: ' + e.message);
    }
}

async function deletePost(postId) {
    if (!confirm('Delete this post permanently?')) return;
    await adminFetch(`/api/admin/posts/${postId}`, { method: 'DELETE' });
    await loadDashboard();
}

async function deleteUser(userId, username) {
    if (!confirm(`Delete ${username} and their messages/posts permanently?`)) return;
    await adminFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    await loadDashboard();
}

async function deleteGroup(groupId, groupName) {
    if (!confirm(`Delete the group "${groupName}" permanently? This cannot be undone.`)) return;
    await adminFetch(`/api/admin/groups/${groupId}`, { method: 'DELETE' });
    await loadDashboard();
}

async function kickMember(groupId, memberId, memberName) {
    if (!confirm(`Kick ${memberName} from this group?`)) return;
    await adminFetch(`/api/admin/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
    await loadDashboard();
}

loginButton.addEventListener('click', login);
passwordInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') login();
});

logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem('tintalk_admin_password');
    adminPassword = '';
    dashboard.classList.add('hidden');
    loginCard.classList.remove('hidden');
    passwordInput.value = '';
});

refreshButton.addEventListener('click', () => {
    loadDashboard().catch(error => alert(error.message));
});

if (adminPassword) {
    loginCard.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadDashboard().catch(() => {
        sessionStorage.removeItem('tintalk_admin_password');
        adminPassword = '';
        dashboard.classList.add('hidden');
        loginCard.classList.remove('hidden');
    });
}
