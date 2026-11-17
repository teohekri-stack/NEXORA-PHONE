--[[---------------------------------------------------------------------------
    Nexora Phone - data access layer
    The only file that talks to oxmysql. Every statement is parameterised and
    every function that touches player owned rows takes the owner (identifier
    or phone number) as an argument so ownership is enforced in the WHERE
    clause instead of being trusted from the client.
-----------------------------------------------------------------------------]]

if not Nexora.Bridge then return end

local Util = Nexora.Util

Nexora.DB = {}
local DB = Nexora.DB

-- Upper bound for "load everything before this id" style paging.
local MAX_ID = 9007199254740991

-------------------------------------------------------------------------------
-- Schema check
-------------------------------------------------------------------------------

local REQUIRED_TABLES = {
    'nexora_phones',
    'nexora_phone_contacts',
    'nexora_phone_messages',
    'nexora_phone_calls',
    'nexora_phone_gallery',
    'nexora_phone_notes',
    'nexora_phone_notifications',
    'nexora_phone_transactions',
    'nexora_phone_app_data',
}

DB.Ready = false

---Verifies that sql/install.sql was imported. Called once on resource start.
---@return boolean ok
function DB.VerifySchema()
    local rows = MySQL.query.await(
        'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?',
        { 'nexora\\_phone%' }
    ) or {}

    local found = {}
    for i = 1, #rows do
        found[tostring(rows[i].name):lower()] = true
    end

    local missing = {}
    for i = 1, #REQUIRED_TABLES do
        if not found[REQUIRED_TABLES[i]] then
            missing[#missing + 1] = REQUIRED_TABLES[i]
        end
    end

    if #missing > 0 then
        Util.Warn(('Missing database tables: %s'):format(table.concat(missing, ', ')))
        Util.Warn('Import sql/install.sql into your database and restart the resource.')
        return false
    end

    DB.Ready = true
    return true
end

-------------------------------------------------------------------------------
-- Phones (number + settings)
-------------------------------------------------------------------------------

---@param identifier string
---@return { phone_number: string, settings: string?, battery: number }?
function DB.GetPhone(identifier)
    return MySQL.single.await(
        'SELECT phone_number, settings, battery FROM nexora_phones WHERE identifier = ? LIMIT 1',
        { identifier }
    )
end

---@return string? identifier
function DB.GetOwnerByNumber(number)
    return MySQL.scalar.await(
        'SELECT identifier FROM nexora_phones WHERE phone_number = ? LIMIT 1',
        { number }
    )
end

---@return string? number
function DB.GetNumberByOwner(identifier)
    return MySQL.scalar.await(
        'SELECT phone_number FROM nexora_phones WHERE identifier = ? LIMIT 1',
        { identifier }
    )
end

function DB.CreatePhone(identifier, number, settingsJson)
    return MySQL.insert.await(
        'INSERT INTO nexora_phones (identifier, phone_number, settings, battery) VALUES (?, ?, ?, 100)',
        { identifier, number, settingsJson }
    )
end

function DB.UpdateNumber(identifier, number)
    return MySQL.update.await(
        'UPDATE nexora_phones SET phone_number = ? WHERE identifier = ?',
        { number, identifier }
    )
end

function DB.SaveSettings(identifier, settingsJson, battery)
    return MySQL.update.await(
        'UPDATE nexora_phones SET settings = ?, battery = ? WHERE identifier = ?',
        { settingsJson, battery, identifier }
    )
end

-------------------------------------------------------------------------------
-- Contacts
-------------------------------------------------------------------------------

function DB.GetContacts(identifier)
    local rows = MySQL.query.await(
        'SELECT id, name, number, avatar, favourite FROM nexora_phone_contacts WHERE identifier = ? ORDER BY name ASC LIMIT ?',
        { identifier, Config.Contacts.maxContacts }
    ) or {}

    for i = 1, #rows do
        rows[i].favourite = Util.ToBool(rows[i].favourite)
    end

    return rows
end

---@return integer id
function DB.AddContact(identifier, name, number, avatar, favourite)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_contacts (identifier, name, number, avatar, favourite) VALUES (?, ?, ?, ?, ?)',
        { identifier, name, number, avatar, favourite and 1 or 0 }
    )
end

---@return integer affectedRows
function DB.UpdateContact(identifier, id, name, number, avatar, favourite)
    return MySQL.update.await(
        'UPDATE nexora_phone_contacts SET name = ?, number = ?, avatar = ?, favourite = ? WHERE id = ? AND identifier = ?',
        { name, number, avatar, favourite and 1 or 0, id, identifier }
    )
end

function DB.DeleteContact(identifier, id)
    return MySQL.update.await(
        'DELETE FROM nexora_phone_contacts WHERE id = ? AND identifier = ?',
        { id, identifier }
    )
end

-------------------------------------------------------------------------------
-- Messages
-------------------------------------------------------------------------------

---Latest message of every conversation `number` takes part in.
function DB.GetConversations(number)
    return MySQL.query.await([[
        SELECT m.id, m.sender, m.receiver, m.body, m.kind, UNIX_TIMESTAMP(m.created_at) AS ts
        FROM nexora_phone_messages m
        INNER JOIN (
            SELECT other, MAX(id) AS id FROM (
                SELECT receiver AS other, MAX(id) AS id
                FROM nexora_phone_messages
                WHERE sender = ? AND deleted_by_sender = 0
                GROUP BY receiver
                UNION ALL
                SELECT sender AS other, MAX(id) AS id
                FROM nexora_phone_messages
                WHERE receiver = ? AND deleted_by_receiver = 0
                GROUP BY sender
            ) merged
            GROUP BY other
        ) latest ON latest.id = m.id
        ORDER BY m.id DESC
        LIMIT 150
    ]], { number, number }) or {}
end

---Unread counters grouped by sender.
function DB.GetUnreadCounts(number)
    return MySQL.query.await(
        'SELECT sender, COUNT(*) AS unread FROM nexora_phone_messages WHERE receiver = ? AND is_read = 0 AND deleted_by_receiver = 0 GROUP BY sender',
        { number }
    ) or {}
end

function DB.GetUnreadTotal(number)
    return MySQL.scalar.await(
        'SELECT COUNT(*) FROM nexora_phone_messages WHERE receiver = ? AND is_read = 0 AND deleted_by_receiver = 0',
        { number }
    ) or 0
end

---One page of a conversation, newest first.
---@param number string owner of the phone
---@param other string the other party
---@param beforeId? integer only messages older than this id
---@param limit integer
function DB.GetThread(number, other, beforeId, limit)
    beforeId = beforeId or MAX_ID

    return MySQL.query.await([[
        (SELECT id, sender, receiver, body, kind, attachment, is_read, UNIX_TIMESTAMP(created_at) AS ts
         FROM nexora_phone_messages
         WHERE sender = ? AND receiver = ? AND deleted_by_sender = 0 AND id < ?
         ORDER BY id DESC LIMIT ?)
        UNION ALL
        (SELECT id, sender, receiver, body, kind, attachment, is_read, UNIX_TIMESTAMP(created_at) AS ts
         FROM nexora_phone_messages
         WHERE sender = ? AND receiver = ? AND deleted_by_receiver = 0 AND id < ?
         ORDER BY id DESC LIMIT ?)
        ORDER BY id DESC
        LIMIT ?
    ]], { number, other, beforeId, limit, other, number, beforeId, limit, limit }) or {}
end

---A single message, only when `number` is one of its two parties and has not
---deleted it.
function DB.GetMessage(number, id)
    return MySQL.single.await([[
        SELECT id, sender, receiver, kind, attachment
        FROM nexora_phone_messages
        WHERE id = ? AND ((sender = ? AND deleted_by_sender = 0) OR (receiver = ? AND deleted_by_receiver = 0))
        LIMIT 1
    ]], { id, number, number })
end

---@return integer id
function DB.InsertMessage(sender, receiver, body, kind, attachment)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_messages (sender, receiver, body, kind, attachment) VALUES (?, ?, ?, ?, ?)',
        { sender, receiver, body, kind, attachment }
    )
end

---Marks everything `other` sent to `number` as read.
function DB.MarkThreadRead(number, other)
    return MySQL.update.await(
        'UPDATE nexora_phone_messages SET is_read = 1 WHERE receiver = ? AND sender = ? AND is_read = 0',
        { number, other }
    )
end

---Hides a whole conversation for `number` only.
function DB.DeleteThread(number, other)
    MySQL.update.await(
        'UPDATE nexora_phone_messages SET deleted_by_sender = 1 WHERE sender = ? AND receiver = ?',
        { number, other }
    )
    MySQL.update.await(
        'UPDATE nexora_phone_messages SET deleted_by_receiver = 1, is_read = 1 WHERE receiver = ? AND sender = ?',
        { number, other }
    )
    -- Rows nobody can see any more are removed for good.
    MySQL.update.await([[
        DELETE FROM nexora_phone_messages
        WHERE deleted_by_sender = 1 AND deleted_by_receiver = 1
          AND ((sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?))
    ]], { number, other, other, number })
end

---Hides a single message for `number` only.
---@return integer affectedRows
function DB.DeleteMessage(number, id)
    return MySQL.update.await([[
        UPDATE nexora_phone_messages
        SET deleted_by_sender = IF(sender = ?, 1, deleted_by_sender),
            deleted_by_receiver = IF(receiver = ?, 1, deleted_by_receiver),
            is_read = IF(receiver = ?, 1, is_read)
        WHERE id = ? AND (sender = ? OR receiver = ?)
    ]], { number, number, number, id, number, number })
end

-------------------------------------------------------------------------------
-- Calls
-------------------------------------------------------------------------------

---@return integer id
function DB.InsertCall(caller, receiver, status, anonymous, duration)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_calls (caller, receiver, status, anonymous, duration) VALUES (?, ?, ?, ?, ?)',
        { caller, receiver, status, anonymous and 1 or 0, duration or 0 }
    )
end

function DB.GetCalls(number, limit)
    return MySQL.query.await([[
        (SELECT id, caller, receiver, status, anonymous, duration, UNIX_TIMESTAMP(created_at) AS ts
         FROM nexora_phone_calls
         WHERE caller = ? AND hidden_by_caller = 0
         ORDER BY id DESC LIMIT ?)
        UNION ALL
        (SELECT id, caller, receiver, status, anonymous, duration, UNIX_TIMESTAMP(created_at) AS ts
         FROM nexora_phone_calls
         WHERE receiver = ? AND hidden_by_receiver = 0
         ORDER BY id DESC LIMIT ?)
        ORDER BY id DESC
        LIMIT ?
    ]], { number, limit, number, limit, limit }) or {}
end

---Hides one call log entry for `number`.
function DB.DeleteCall(number, id)
    return MySQL.update.await([[
        UPDATE nexora_phone_calls
        SET hidden_by_caller = IF(caller = ?, 1, hidden_by_caller),
            hidden_by_receiver = IF(receiver = ?, 1, hidden_by_receiver)
        WHERE id = ? AND (caller = ? OR receiver = ?)
    ]], { number, number, id, number, number })
end

---Hides the complete call log for `number`.
function DB.ClearCalls(number)
    MySQL.update.await('UPDATE nexora_phone_calls SET hidden_by_caller = 1 WHERE caller = ?', { number })
    MySQL.update.await('UPDATE nexora_phone_calls SET hidden_by_receiver = 1 WHERE receiver = ?', { number })
    MySQL.update.await('DELETE FROM nexora_phone_calls WHERE hidden_by_caller = 1 AND hidden_by_receiver = 1 AND (caller = ? OR receiver = ?)', { number, number })
end

-------------------------------------------------------------------------------
-- Gallery
-------------------------------------------------------------------------------

function DB.GetGallery(identifier)
    return MySQL.query.await(
        'SELECT id, url, UNIX_TIMESTAMP(created_at) AS ts FROM nexora_phone_gallery WHERE identifier = ? ORDER BY id DESC LIMIT ?',
        { identifier, Config.Gallery.maxImages }
    ) or {}
end

function DB.CountGallery(identifier)
    return MySQL.scalar.await('SELECT COUNT(*) FROM nexora_phone_gallery WHERE identifier = ?', { identifier }) or 0
end

---@return integer id
function DB.AddImage(identifier, url)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_gallery (identifier, url) VALUES (?, ?)',
        { identifier, url }
    )
end

---@return integer affectedRows
function DB.DeleteImage(identifier, id)
    return MySQL.update.await(
        'DELETE FROM nexora_phone_gallery WHERE id = ? AND identifier = ?',
        { id, identifier }
    )
end

---True when the url belongs to a picture in this character's gallery.
function DB.OwnsImage(identifier, url)
    return MySQL.scalar.await(
        'SELECT 1 FROM nexora_phone_gallery WHERE identifier = ? AND url = ? LIMIT 1',
        { identifier, url }
    ) ~= nil
end

-------------------------------------------------------------------------------
-- Notes
-------------------------------------------------------------------------------

function DB.GetNotes(identifier)
    return MySQL.query.await(
        'SELECT id, title, body, pinned, UNIX_TIMESTAMP(updated_at) AS ts FROM nexora_phone_notes WHERE identifier = ? ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ?',
        { identifier, Config.Notes.maxNotes }
    ) or {}
end

function DB.CountNotes(identifier)
    return MySQL.scalar.await('SELECT COUNT(*) FROM nexora_phone_notes WHERE identifier = ?', { identifier }) or 0
end

---@return integer id
function DB.InsertNote(identifier, title, body, pinned)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_notes (identifier, title, body, pinned) VALUES (?, ?, ?, ?)',
        { identifier, title, body, pinned and 1 or 0 }
    )
end

---@return integer affectedRows
function DB.UpdateNote(identifier, id, title, body, pinned)
    return MySQL.update.await(
        'UPDATE nexora_phone_notes SET title = ?, body = ?, pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND identifier = ?',
        { title, body, pinned and 1 or 0, id, identifier }
    )
end

function DB.NoteExists(identifier, id)
    return MySQL.scalar.await('SELECT 1 FROM nexora_phone_notes WHERE id = ? AND identifier = ? LIMIT 1', { id, identifier }) ~= nil
end

function DB.DeleteNote(identifier, id)
    return MySQL.update.await(
        'DELETE FROM nexora_phone_notes WHERE id = ? AND identifier = ?',
        { id, identifier }
    )
end

-------------------------------------------------------------------------------
-- Notifications
-------------------------------------------------------------------------------

function DB.GetNotifications(identifier)
    return MySQL.query.await(
        'SELECT id, app, title, body, UNIX_TIMESTAMP(created_at) AS ts FROM nexora_phone_notifications WHERE identifier = ? ORDER BY id DESC LIMIT ?',
        { identifier, Config.Notifications.maxStored }
    ) or {}
end

---@return integer id
function DB.AddNotification(identifier, app, title, body)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_notifications (identifier, app, title, body) VALUES (?, ?, ?, ?)',
        { identifier, app, title, body }
    )
end

function DB.DeleteNotification(identifier, id)
    return MySQL.update.await(
        'DELETE FROM nexora_phone_notifications WHERE id = ? AND identifier = ?',
        { id, identifier }
    )
end

function DB.ClearNotifications(identifier, app)
    if app then
        return MySQL.update.await('DELETE FROM nexora_phone_notifications WHERE identifier = ? AND app = ?', { identifier, app })
    end
    return MySQL.update.await('DELETE FROM nexora_phone_notifications WHERE identifier = ?', { identifier })
end

---Keeps only the newest Config.Notifications.maxStored rows of a character.
function DB.TrimNotifications(identifier)
    return MySQL.update.await([[
        DELETE FROM nexora_phone_notifications
        WHERE identifier = ? AND id <= (
            SELECT id FROM (
                SELECT id FROM nexora_phone_notifications
                WHERE identifier = ?
                ORDER BY id DESC
                LIMIT 1 OFFSET ?
            ) oldest
        )
    ]], { identifier, identifier, Config.Notifications.maxStored })
end

-------------------------------------------------------------------------------
-- Bank transfers
-------------------------------------------------------------------------------

---@return integer id
function DB.AddTransaction(senderId, senderName, receiverId, receiverName, amount, fee, reason)
    return MySQL.insert.await(
        'INSERT INTO nexora_phone_transactions (sender_id, sender_name, receiver_id, receiver_name, amount, fee, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
        { senderId, senderName, receiverId, receiverName, amount, fee, reason }
    )
end

function DB.GetTransactions(identifier, limit)
    return MySQL.query.await([[
        (SELECT id, sender_id, sender_name, receiver_id, receiver_name, amount, fee, reason, UNIX_TIMESTAMP(created_at) AS ts
         FROM nexora_phone_transactions
         WHERE sender_id = ?
         ORDER BY id DESC LIMIT ?)
        UNION
        (SELECT id, sender_id, sender_name, receiver_id, receiver_name, amount, fee, reason, UNIX_TIMESTAMP(created_at) AS ts
         FROM nexora_phone_transactions
         WHERE receiver_id = ?
         ORDER BY id DESC LIMIT ?)
        ORDER BY id DESC
        LIMIT ?
    ]], { identifier, limit, identifier, limit, limit }) or {}
end

-------------------------------------------------------------------------------
-- Generic per-app storage
-------------------------------------------------------------------------------

---@return table? data decoded JSON or nil
function DB.GetAppData(identifier, app)
    local raw = MySQL.scalar.await(
        'SELECT data FROM nexora_phone_app_data WHERE identifier = ? AND app = ? LIMIT 1',
        { identifier, app }
    )
    if not raw then return nil end

    local ok, data = pcall(json.decode, raw)
    return ok and type(data) == 'table' and data or nil
end

function DB.SetAppData(identifier, app, data)
    return MySQL.update.await(
        'INSERT INTO nexora_phone_app_data (identifier, app, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        { identifier, app, json.encode(data) }
    )
end
