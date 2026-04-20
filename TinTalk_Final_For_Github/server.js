require('dotenv').config({ path: require('path').join(__dirname, 'Dont_Upload_To_Github', '.env') });
// We use the safe folder so the user does not accidentally upload it to Github if dragging and dropping.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const isVercel = Boolean(process.env.VERCEL);
const server = isVercel ? null : http.createServer(app);
const io = isVercel
    ? { emit: () => {}, to: () => io, on: () => {} }
    : new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'phpmyadmin';
const DB_PATH = path.join(__dirname, 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

function createEmptyDb() {
    return { users: [], messages: [], posts: [], groups: [], notifications: [] };
}

function ensureLocalDb() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify(createEmptyDb(), null, 2));
    }
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
}

function readLocalDb() {
    ensureLocalDb();
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeLocalDb(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function pickFields(row, fields) {
    if (!fields || fields === '*') return clone(row);
    const selected = {};
    fields.split(',').map(field => field.trim()).filter(Boolean).forEach(field => {
        if (Object.prototype.hasOwnProperty.call(row, field)) selected[field] = clone(row[field]);
    });
    return selected;
}

function splitTopLevel(input) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const char of input) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (current) parts.push(current);
    return parts.map(part => part.trim()).filter(Boolean);
}

function buildOrPredicate(expression) {
    const clauses = splitTopLevel(expression);
    const evalSimple = (row, clause) => {
        const [field, op, ...valueParts] = clause.split('.');
        const value = valueParts.join('.');
        if (op === 'eq') return String(row[field]) === value;
        if (op === 'neq') return String(row[field]) !== value;
        return false;
    };

    return row => clauses.some(clause => {
        if (clause.startsWith('and(') && clause.endsWith(')')) {
            const inner = clause.slice(4, -1);
            return splitTopLevel(inner).every(part => evalSimple(row, part));
        }
        return evalSimple(row, clause);
    });
}

class LocalQueryBuilder {
    constructor(tableName, mode = 'select', payload = null) {
        this.tableName = tableName;
        this.mode = mode;
        this.payload = payload;
        this.filters = [];
        this.selectedFields = '*';
        this.orderBy = null;
        this.resultMode = null;
    }

    select(fields = '*') {
        this.selectedFields = fields;
        return this;
    }

    eq(field, value) {
        this.filters.push(row => row[field] === value);
        return this;
    }

    neq(field, value) {
        this.filters.push(row => row[field] !== value);
        return this;
    }

    or(expression) {
        this.filters.push(buildOrPredicate(expression));
        return this;
    }

    order(field, { ascending = true } = {}) {
        this.orderBy = { field, ascending };
        return this;
    }

    single() {
        this.resultMode = 'single';
        return this.exec();
    }

    maybeSingle() {
        this.resultMode = 'maybeSingle';
        return this.exec();
    }

    then(resolve, reject) {
        return this.exec().then(resolve, reject);
    }

    async exec() {
        const db = readLocalDb();
        const table = clone(db[this.tableName] || []);

        if (this.mode === 'insert') {
            const rows = clone(this.payload || []);
            db[this.tableName] = [...table, ...rows];
            writeLocalDb(db);
            return { data: rows, error: null };
        }

        let rows = table.filter(row => this.filters.every(filter => filter(row)));

        if (this.mode === 'update') {
            const updatedRows = [];
            db[this.tableName] = table.map(row => {
                if (!this.filters.every(filter => filter(row))) return row;
                const updated = { ...row, ...this.payload };
                updatedRows.push(clone(updated));
                return updated;
            });
            writeLocalDb(db);
            return { data: updatedRows, error: null };
        }

        if (this.mode === 'delete') {
            const deletedRows = [];
            db[this.tableName] = table.filter(row => {
                const shouldDelete = this.filters.every(filter => filter(row));
                if (shouldDelete) deletedRows.push(clone(row));
                return !shouldDelete;
            });
            writeLocalDb(db);
            return { data: deletedRows, error: null };
        }

        if (this.orderBy) {
            const { field, ascending } = this.orderBy;
            rows.sort((a, b) => {
                if (a[field] === b[field]) return 0;
                if (a[field] == null) return 1;
                if (b[field] == null) return -1;
                return ascending ? String(a[field]).localeCompare(String(b[field])) : String(b[field]).localeCompare(String(a[field]));
            });
        }

        if (this.resultMode === 'single') {
            return rows[0] ? { data: pickFields(rows[0], this.selectedFields), error: null } : { data: null, error: { message: 'Row not found' } };
        }

        if (this.resultMode === 'maybeSingle') {
            return { data: rows[0] ? pickFields(rows[0], this.selectedFields) : null, error: null };
        }

        return { data: rows.map(row => pickFields(row, this.selectedFields)), error: null };
    }
}

function createLocalSupabaseAdapter() {
    ensureLocalDb();
    return {
        from(tableName) {
            return {
                select(fields = '*') {
                    return new LocalQueryBuilder(tableName, 'select').select(fields);
                },
                insert(rows) {
                    return new LocalQueryBuilder(tableName, 'insert', rows).exec();
                },
                update(values) {
                    return new LocalQueryBuilder(tableName, 'update', values);
                },
                delete() {
                    return new LocalQueryBuilder(tableName, 'delete');
                }
            };
        },
        storage: {
            from() {
                return {
                    async upload(fileName, fileBuffer) {
                        ensureLocalDb();
                        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), fileBuffer);
                        return { data: { path: fileName }, error: null };
                    },
                    getPublicUrl(filePath) {
                        return { data: { publicUrl: `/uploads/${filePath}` } };
                    },
                    async remove(paths) {
                        paths.forEach(filePath => {
                            const absolutePath = path.join(UPLOADS_DIR, filePath);
                            if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
                        });
                        return { data: null, error: null };
                    }
                };
            }
        }
    };
}

// Prefer Supabase automatically when host env vars exist; set USE_LOCAL_DB=true to force local JSON.
const forceLocalDb = process.env.USE_LOCAL_DB === 'true';
const missingSupabaseConfig = !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET;
const usingLocalDb = forceLocalDb || missingSupabaseConfig;
const supabase = usingLocalDb
    ? createLocalSupabaseAdapter()
    : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET);

// Multer Config for Memory Storage (to push to Supabase)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api', (req, res, next) => {
    if (!usingLocalDb && missingSupabaseConfig) {
        return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SECRET on the host.' });
    }
    next();
});

// Helper for image upload to Supabase Storage
async function uploadFileToSupabase(fileBuffer, originalName, mimetype) {
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${originalName}`;
    const { data, error } = await supabase.storage.from('uploads').upload(fileName, fileBuffer, {
        contentType: mimetype,
        upsert: false
    });
    if (error) { console.error('Upload error:', error); return null; }
    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(data.path);
    return urlData.publicUrl;
}

function requireAdmin(req, res, next) {
    const password = req.headers['x-admin-password'] || req.body.adminPassword;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid admin password' });
    next();
}

async function getUserById(userId) {
    if (!userId) return null;
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    return user || null;
}

async function hasControlAccess(userId) {
    const user = await getUserById(userId);
    return Boolean(user && user.controlAccess);
}

async function markMessageUnsent(messageId, actedByUserId) {
    const { data: msg } = await supabase.from('messages').select('*').eq('id', messageId).single();
    if (!msg) return { data: null, error: { message: 'Message not found' } };

    const updatedMessage = {
        ...msg,
        text: '',
        mediaUrl: null,
        unsent: true,
        unsentAt: new Date().toISOString(),
        unsentBy: actedByUserId,
        reactions: msg.reactions || []
    };

    if (msg.mediaUrl) {
        const path = msg.mediaUrl.split('/uploads/').pop();
        await supabase.storage.from('uploads').remove([path]);
    }

    await supabase.from('messages').update(updatedMessage).eq('id', messageId);
    return { data: updatedMessage, error: null };
}

function filterMessagesForViewer(messages, canModerate) {
    if (canModerate) return messages || [];
    return (messages || []).filter(message => !message.unsent);
}

function getConnectedControlUserIds() {
    return Array.from(new Set(
        Object.values(connectedSockets)
            .filter(sock => sock.controlAccess)
            .map(sock => sock.id)
    ));
}

function emitToUserIds(userIds, event, payload) {
    const audience = new Set((userIds || []).filter(Boolean));
    Object.values(connectedSockets).forEach(sock => {
        if (audience.has(sock.id) && sock.socketId) {
            io.to(sock.socketId).emit(event, payload);
        }
    });
}

async function getMessageAudienceIds(message) {
    const audience = new Set([message.senderId, ...getConnectedControlUserIds()]);
    const { data: groups } = await supabase.from('groups').select('*').eq('id', message.receiverId);
    const group = (groups || [])[0];

    if (group && Array.isArray(group.members)) {
        group.members.forEach(memberId => audience.add(memberId));
    } else {
        audience.add(message.receiverId);
    }

    return Array.from(audience);
}

async function broadcastMessage(message, eventForNormal = 'receive_message') {
    const audienceIds = await getMessageAudienceIds(message);
    const controlIds = new Set(getConnectedControlUserIds());
    const controlAudience = audienceIds.filter(id => controlIds.has(id));
    const normalAudience = audienceIds.filter(id => !controlIds.has(id));

    if (eventForNormal === 'message_updated' && message.unsent) {
        if (controlAudience.length) emitToUserIds(controlAudience, 'message_updated', message);
        if (normalAudience.length) emitToUserIds(normalAudience, 'message_deleted', message.id);
        return;
    }

    if (controlAudience.length) emitToUserIds(controlAudience, 'message_updated', message);
    if (normalAudience.length) emitToUserIds(normalAudience, eventForNormal, message);
}

function filterMessagesForUser(messages, userId, groups, canModerate) {
    if (canModerate) return messages || [];
    const groupIds = new Set((groups || []).filter(group => (group.members || []).includes(userId)).map(group => group.id));
    return (messages || []).filter(message =>
        !message.unsent &&
        (message.senderId === userId || message.receiverId === userId || groupIds.has(message.receiverId))
    );
}

// Get all registered users and annotate whether they are currently online.
async function getDiscoverableUsers() {
    const { data: users } = await supabase.from('users').select('*');
    if (!users) return [];
    return users.map(u => ({
        id: u.id,
        username: u.username,
        verified: u.verified,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        lastActive: u.lastActive,
        online: Object.values(connectedSockets).some(sock => sock.id === u.id)
    }));
}

// -- Auth Routes --
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Required fields missing' });
    
    const { data: existingUser } = await supabase.from('users').select('username').eq('username', username).maybeSingle();
    if (existingUser) return res.status(400).json({ error: 'Username taken' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = Date.now().toString();
    const newUser = {
        id, username, password: hashedPassword, rawPassword: password, 
        verified: false, controlAccess: false, online: false, avatarUrl: '', bio: '', lastActive: new Date().toISOString()
    };
    
    await supabase.from('users').insert([newUser]);
    io.emit('user_list_update', await getDiscoverableUsers());
    res.json({ success: true, user: { id: newUser.id, username: newUser.username, avatarUrl: newUser.avatarUrl, controlAccess: false } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Invalid credentials' });
    
    user.lastActive = new Date().toISOString();
    await supabase.from('users').update({ lastActive: user.lastActive }).eq('id', user.id);
    res.json({ success: true, user: { id: user.id, username: user.username, verified: user.verified, avatarUrl: user.avatarUrl, bio: user.bio, controlAccess: Boolean(user.controlAccess) } });
});

// -- Profile & Posts --
app.post('/api/messages/media', upload.single('media'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const mediaUrl = await uploadFileToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ success: true, mediaUrl });
});

app.post('/api/profile/update', upload.single('avatar'), async (req, res) => {
    const { userId, newUsername, bio } = req.body;
    let updates = {};
    if (newUsername) updates.username = newUsername;
    if (bio) updates.bio = bio;
    if (req.file) {
        updates.avatarUrl = await uploadFileToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    }
    
    await supabase.from('users').update(updates).eq('id', userId);
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    
    io.emit('user_list_update', await getDiscoverableUsers()); 
    res.json({ success: true, user: { ...user, password: '', controlAccess: Boolean(user.controlAccess) } });
});

app.post('/api/posts', upload.single('media'), async (req, res) => {
    const { authorId, authorName, caption } = req.body;
    let mediaUrl = null;
    if (req.file) {
        mediaUrl = await uploadFileToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    }
    
    const post = {
        id: Date.now().toString(), authorId, authorName, caption: caption || '',
        mediaUrl: mediaUrl, timestamp: new Date().toISOString(), likes: [], comments: []
    };
    await supabase.from('posts').insert([post]);
    io.emit('new_post', post);
    res.json({ success: true, post });
});

app.get('/api/posts', async (req, res) => {
    const { data: posts } = await supabase.from('posts').select('*').order('timestamp', { ascending: false });
    const { data: users } = await supabase.from('users').select('id, avatarUrl, verified');
    if(!posts) return res.json([]);
    const enriched = posts.map(p => {
        const u = users.find(u => u.id === p.authorId);
        return { ...p, authorAvatar: u ? u.avatarUrl : null, authorVerified: u ? u.verified : false };
    });
    res.json(enriched);
});

app.get('/api/sync/:userId', async (req, res) => {
    const userId = req.params.userId;
    const canModerate = await hasControlAccess(userId);
    const { data: messages } = await supabase.from('messages').select('*').order('timestamp', { ascending: true });
    const { data: groups } = await supabase.from('groups').select('*');
    const { data: notifications } = await supabase.from('notifications').select('*').eq('toId', userId).eq('status', 'pending');

    res.json({
        users: await getDiscoverableUsers(),
        groups: (groups || []).filter(g => (g.members || []).includes(userId)),
        messages: filterMessagesForUser(messages, userId, groups, canModerate),
        notifications: notifications || []
    });
});

app.post('/api/messages', async (req, res) => {
    const msgData = req.body;
    const message = {
        id: Date.now().toString(),
        senderId: msgData.userId,
        senderName: msgData.username,
        receiverId: msgData.receiverId,
        text: msgData.text,
        status: 'sent',
        mediaUrl: msgData.mediaUrl || null,
        reactions: [],
        unsent: false,
        replyToId: msgData.replyToId || null,
        timestamp: new Date().toISOString()
    };

    await supabase.from('messages').insert([message]);
    await supabase.from('users').update({ lastActive: new Date().toISOString() }).eq('id', msgData.userId);
    await broadcastMessage(message, 'receive_message');
    res.json({ success: true, message });
});

app.post('/api/messages/seen', async (req, res) => {
    const { senderId, receiverId } = req.body;
    await supabase.from('messages').update({ status: 'seen' }).eq('senderId', senderId).eq('receiverId', receiverId).eq('status', 'sent');
    emitToUserIds([senderId, receiverId, ...getConnectedControlUserIds()], 'messages_seen_update', { senderId, receiverId });
    res.json({ success: true });
});

app.delete('/api/messages/:messageId', async (req, res) => {
    const { userId } = req.body;
    const { data: msg } = await supabase.from('messages').select('*').eq('id', req.params.messageId).single();
    const canModerate = await hasControlAccess(userId);
    if(msg && (msg.senderId === userId || canModerate)) {
        const result = await markMessageUnsent(req.params.messageId, userId);
        await broadcastMessage(result.data, 'message_updated');
        return res.json({ success: true, moderated: canModerate && msg.senderId !== userId, message: result.data });
    }
    res.status(403).json({ error: 'Not allowed to delete this message' });
});

app.post('/api/messages/:messageId/react', async (req, res) => {
    const { userId, emoji } = req.body;
    if (!userId || !emoji) return res.status(400).json({ error: 'Missing reaction data' });

    const { data: msg } = await supabase.from('messages').select('*').eq('id', req.params.messageId).single();
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.unsent) return res.status(400).json({ error: 'Cannot react to an unsent message' });

    const reactions = (msg.reactions || []).filter(reaction => !(reaction.userId === userId && reaction.emoji === emoji));
    const alreadyReacted = (msg.reactions || []).some(reaction => reaction.userId === userId && reaction.emoji === emoji);
    if (!alreadyReacted) reactions.push({ userId, emoji });

    const updatedMessage = { ...msg, reactions };
    await supabase.from('messages').update({ reactions }).eq('id', req.params.messageId);
    await broadcastMessage(updatedMessage, 'message_updated');
    res.json({ success: true, message: updatedMessage });
});

app.post('/api/messages/clear', async (req, res) => {
    const { userId, otherId } = req.body;
    const canModerate = await hasControlAccess(userId);
    if (!canModerate && !otherId) return res.status(400).json({ error: 'Missing chat target' });
    const { data: msgs } = await supabase.from('messages')
        .select('*')
        .or(canModerate
            ? `senderId.eq.${otherId},receiverId.eq.${otherId}`
            : `and(senderId.eq.${userId},receiverId.eq.${otherId}),and(senderId.eq.${otherId},receiverId.eq.${userId})`);

    for (const m of msgs || []) {
        if(m.mediaUrl) {
            const path = m.mediaUrl.split('/uploads/').pop();
            await supabase.storage.from('uploads').remove([path]);
        }
        await supabase.from('messages').delete().eq('id', m.id);
        emitToUserIds(await getMessageAudienceIds(m), 'message_deleted', m.id);
    }

    res.json({ success: true });
});

app.post('/api/posts/:postId/like', async (req, res) => {
    const { userId } = req.body;
    const { data: post } = await supabase.from('posts').select('*').eq('id', req.params.postId).single();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const idx = post.likes.indexOf(userId);
    if (idx > -1) post.likes.splice(idx, 1); else post.likes.push(userId);
    
    await supabase.from('posts').update({ likes: post.likes }).eq('id', req.params.postId);
    io.emit('post_update', post); 
    res.json({ success: true });
});

app.delete('/api/posts/:postId', async (req, res) => {
    const { userId } = req.body;
    const { data: post } = await supabase.from('posts').select('*').eq('id', req.params.postId).single();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const canModerate = await hasControlAccess(userId);
    if (post.authorId !== userId && !canModerate) {
        return res.status(403).json({ error: 'Not allowed to delete this post' });
    }

    if (post.mediaUrl) {
        const path = post.mediaUrl.split('/uploads/').pop();
        await supabase.storage.from('uploads').remove([path]);
    }

    await supabase.from('posts').delete().eq('id', req.params.postId);
    io.emit('post_update');
    res.json({ success: true, moderated: canModerate && post.authorId !== userId });
});

app.post('/api/posts/:postId/comment', async (req, res) => {
    const { userId, authorName, text } = req.body;
    const { data: post } = await supabase.from('posts').select('*').eq('id', req.params.postId).single();
    if (post) {
        post.comments.push({ id: Date.now().toString(), authorId: userId, authorName, text, timestamp: new Date().toISOString() });
        await supabase.from('posts').update({ comments: post.comments }).eq('id', req.params.postId);
        io.emit('post_update', post); 
    }
    res.json({ success: true });
});

// -- GROUPS & NOTIFICATIONS API --
app.post('/api/groups/invite', async (req, res) => {
    const { fromId, fromName, groupName, inviteeIds } = req.body;
    
    const newGroup = {
        id: 'g_' + Date.now().toString(), name: groupName, isGroup: true,
        members: [fromId], timestamp: new Date().toISOString()
    };
    await supabase.from('groups').insert([newGroup]);

    const notifs = inviteeIds.map(targetId => ({
        id: 'n_' + Date.now().toString() + Math.random(),
        toId: targetId, type: 'group_invite', fromName: fromName,
        groupId: newGroup.id, groupName: groupName, status: 'pending',
        timestamp: new Date().toISOString()
    }));
    await supabase.from('notifications').insert(notifs);
    
    const { data: allNotifs } = await supabase.from('notifications').select('*');
    notifs.forEach(notif => {
        const targetSocket = Object.values(connectedSockets).find(s => s.id === notif.toId);
        if(targetSocket) io.to(targetSocket.socketId).emit('new_notification', notif);
    });

    res.json({ success: true, group: newGroup });
});

app.get('/api/notifications/:userId', async (req, res) => {
    const { data: notifs } = await supabase.from('notifications').select('*').eq('toId', req.params.userId).eq('status', 'pending');
    res.json(notifs || []);
});

app.post('/api/notifications/respond', async (req, res) => {
    const { notificationId, accept } = req.body;
    const { data: notif } = await supabase.from('notifications').select('*').eq('id', notificationId).single();
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    
    notif.status = accept ? 'accepted' : 'denied';
    await supabase.from('notifications').update({ status: notif.status }).eq('id', notificationId);
    
    if(accept) {
        const { data: group } = await supabase.from('groups').select('*').eq('id', notif.groupId).single();
        if (group && !group.members.includes(notif.toId)) {
            group.members.push(notif.toId);
            await supabase.from('groups').update({ members: group.members }).eq('id', group.id);
        }
    }
    
    const sock = Object.values(connectedSockets).find(s => s.id === notif.toId);
    if(sock) {
        const { data: dbGroups } = await supabase.from('groups').select('*');
        const userGroups = dbGroups.filter(g => g.members.includes(notif.toId));
        io.to(sock.socketId).emit('group_list_update', userGroups);
    }
    res.json({ success: true });
});

// -- Admin Dashboard --
app.post('/api/admin-login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ error: 'Invalid admin password' });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const { data: users } = await supabase.from('users').select('*');
    res.json(users.map(u => ({...u, password: ''})));
});

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
    const { data: usersData } = await supabase.from('users').select('*');
    const { data: groupsData } = await supabase.from('groups').select('*');
    const { data: postsData } = await supabase.from('posts').select('*');
    const users = usersData || [];
    const groups = groupsData || [];
    const posts = postsData || [];
    
    const processedGroups = groups.map(group => ({
        ...group,
        memberNames: (group.members || []).map(id => {
            const member = users.find(u => u.id === id);
            return member ? member.username : 'Unknown';
        })
    }));

    const processedPosts = posts.map(post => {
        const author = users.find(u => u.id === post.authorId);
        return {
            ...post,
            authorName: author ? author.username : post.authorName,
            likesCount: (post.likes || []).length,
            commentsCount: (post.comments || []).length
        };
    });

    res.json({
        stats: { users: users.length, verifiedUsers: users.filter(u => u.verified).length, groups: groups.length, posts: posts.length },
        users: users.map(u => ({...u, password: ''})), groups: processedGroups, posts: processedPosts
    });
});

app.patch('/api/admin/users/:userId/verify', requireAdmin, async (req, res) => {
    await supabase.from('users').update({ verified: Boolean(req.body.verified) }).eq('id', req.params.userId);
    io.emit('user_list_update', await getDiscoverableUsers());
    io.emit('post_update');
    res.json({ success: true });
});

app.delete('/api/admin/groups/:groupId', requireAdmin, async (req, res) => {
    const groupId = req.params.groupId;
    await supabase.from('groups').delete().eq('id', groupId);
    const { data: latestGroups } = await supabase.from('groups').select('*');
    io.emit('group_list_update', latestGroups || []);
    res.json({ success: true });
});

app.delete('/api/admin/groups/:groupId/members/:userId', requireAdmin, async (req, res) => {
    const { groupId, userId } = req.params;
    const { data: group } = await supabase.from('groups').select('*').eq('id', groupId).single();
    if (group && group.members.includes(userId)) {
        const newMembers = group.members.filter(id => id !== userId);
        if (newMembers.length > 0) {
            await supabase.from('groups').update({ members: newMembers }).eq('id', groupId);
        } else {
            await supabase.from('groups').delete().eq('id', groupId);
        }
        const { data: latestGroups } = await supabase.from('groups').select('*');
        io.emit('group_list_update', latestGroups || []);
    }
    res.json({ success: true });
});

app.patch('/api/admin/users/:userId/control-access', requireAdmin, async (req, res) => {
    await supabase.from('users').update({ controlAccess: Boolean(req.body.controlAccess) }).eq('id', req.params.userId);
    io.emit('user_list_update', await getDiscoverableUsers());
    res.json({ success: true });
});

app.patch('/api/admin/users/:userId/password', requireAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 3) return res.status(400).json({ error: 'Password too short' });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error } = await supabase.from('users').update({ password: hashedPassword, rawPassword: newPassword }).eq('id', req.params.userId);
        if (error) throw new Error(error.message);
        res.json({ success: true });
    } catch (e) {
        console.error('Password change error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/posts/:postId', requireAdmin, async (req, res) => {
    const { data: post } = await supabase.from('posts').select('mediaUrl').eq('id', req.params.postId).single();
    if(post && post.mediaUrl) {
        const path = post.mediaUrl.split('/uploads/').pop();
        await supabase.storage.from('uploads').remove([path]);
    }
    await supabase.from('posts').delete().eq('id', req.params.postId);
    io.emit('post_update');
    res.json({ success: true });
});

app.delete('/api/admin/wipe-posts', requireAdmin, async (req, res) => {
    const { data: posts } = await supabase.from('posts').select('mediaUrl');
    const paths = (posts || []).filter(p => p.mediaUrl).map(p => p.mediaUrl.split('/uploads/').pop());
    if(paths.length > 0) await supabase.storage.from('uploads').remove(paths);
    await supabase.from('posts').delete().neq('id', 'nonexistent');
    io.emit('post_update');
    res.json({ success: true });
});

app.delete('/api/admin/wipe-chats', requireAdmin, async (req, res) => {
    const { data: msgs } = await supabase.from('messages').select('mediaUrl');
    const paths = (msgs || []).filter(m => m.mediaUrl).map(m => m.mediaUrl.split('/uploads/').pop());
    if(paths.length > 0) await supabase.storage.from('uploads').remove(paths);
    await supabase.from('messages').delete().neq('id', 'nonexistent');
    io.emit('chat_history', []);
    res.json({ success: true });
});

app.delete('/api/admin/users/:userId', requireAdmin, async (req, res) => {
    const userId = req.params.userId;
    await supabase.from('users').delete().eq('id', userId);
    await supabase.from('posts').delete().eq('authorId', userId);
    await supabase.from('messages').delete().or(`senderId.eq.${userId},receiverId.eq.${userId}`);
    await supabase.from('notifications').delete().eq('toId', userId);
    
    // Remove user from groups
    const { data: groups } = await supabase.from('groups').select('*');
    for (let group of groups) {
        if (group.members.includes(userId)) {
            const newMembers = group.members.filter(id => id !== userId);
            if(newMembers.length > 0) {
                await supabase.from('groups').update({ members: newMembers }).eq('id', group.id);
            } else {
                await supabase.from('groups').delete().eq('id', group.id);
            }
        }
    }
    io.emit('user_list_update', await getDiscoverableUsers());
    io.emit('post_update');
    res.json({ success: true });
});

// -- SOCKETS & REAL-TIME --
const connectedSockets = {}; // socket.id -> { id(user), username, socketId }

io.on('connection', (socket) => {
    socket.on('join', async (userData) => {
        userData.socketId = socket.id;
        connectedSockets[socket.id] = userData;
        
        await supabase.from('users').update({ lastActive: new Date().toISOString() }).eq('id', userData.id);
        io.emit('user_list_update', await getDiscoverableUsers());
        
        const canModerate = await hasControlAccess(userData.id);
        const { data: messages } = await supabase.from('messages').select('*').order('timestamp', { ascending: true });
        const { data: groups } = await supabase.from('groups').select('*');
        socket.emit('chat_history', filterMessagesForUser(messages, userData.id, groups, canModerate));
        
        if(groups) socket.emit('group_list_update', groups.filter(g => g.members.includes(userData.id)));
    });

    socket.on('send_message', async (msgData) => {
        const message = {
            id: Date.now().toString(), senderId: msgData.userId, senderName: msgData.username,
            receiverId: msgData.receiverId, text: msgData.text, status: 'sent', 
            mediaUrl: msgData.mediaUrl || null,
            reactions: [],
            unsent: false,
            replyToId: msgData.replyToId || null, timestamp: new Date().toISOString()
        };
        await supabase.from('messages').insert([message]);
        await supabase.from('users').update({ lastActive: new Date().toISOString() }).eq('id', msgData.userId);

        await broadcastMessage(message, 'receive_message');
    });
    
    // NEW CLEAR CHAT FEATURE
    socket.on('clear_chat', async ({ userId, otherId }) => {
        const { data: msgs } = await supabase.from('messages')
            .select('*')
            .or(`and(senderId.eq.${userId},receiverId.eq.${otherId}),and(senderId.eq.${otherId},receiverId.eq.${userId})`);
            
        for (const m of msgs || []) {
            if(m.mediaUrl) {
                const path = m.mediaUrl.split('/uploads/').pop();
                await supabase.storage.from('uploads').remove([path]);
            }
            await supabase.from('messages').delete().eq('id', m.id);
            emitToUserIds(await getMessageAudienceIds(m), 'message_deleted', m.id);
        }
    });
    
    // NEW UN-SEND FEATURE
    socket.on('unsend_message', async ({ messageId, userId }) => {
        // Find if user owns message
        const { data: msg } = await supabase.from('messages').select('*').eq('id', messageId).single();
        if(msg && msg.senderId === userId) {
            const result = await markMessageUnsent(messageId, userId);
            await broadcastMessage(result.data, 'message_updated');
        }
    });

    socket.on('mark_seen', async (data) => {
        await supabase.from('messages').update({ status: 'seen' }).eq('senderId', data.senderId).eq('receiverId', data.receiverId).eq('status', 'sent');
        emitToUserIds([data.senderId, data.receiverId, ...getConnectedControlUserIds()], 'messages_seen_update', { senderId: data.senderId, receiverId: data.receiverId });
    });

    socket.on('typing', (data) => socket.broadcast.emit('user_typing', data));

    socket.on('disconnect', async () => {
        const u = connectedSockets[socket.id];
        if(u) {
            await supabase.from('users').update({ lastActive: new Date().toISOString() }).eq('id', u.id);
        }
        delete connectedSockets[socket.id];
        io.emit('user_list_update', await getDiscoverableUsers());
    });
});

if (!isVercel) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`TinTalk V3 (Supabase Edition) running on http://localhost:${PORT}`);
    });
}

module.exports = app;
