--[[---------------------------------------------------------------------------
    Nexora Phone - app endpoints
    Contacts, notes, gallery / camera, settings, notification centre and
    alarms. Every handler receives the caller's session from the callback
    wrapper, so rows are always read and written for that character only.
-----------------------------------------------------------------------------]]

if not Nexora.Bridge then return end

local Util = Nexora.Util
local DB = Nexora.DB

-------------------------------------------------------------------------------
-- Contacts
-------------------------------------------------------------------------------

---@return table? contact, integer? index
local function findContact(session, id)
    for i = 1, #session.contacts do
        if session.contacts[i].id == id then
            return session.contacts[i], i
        end
    end
    return nil
end

---Validates contact data sent by a client.
---@param ignoreId? integer contact being edited (skipped by the duplicate check)
---@return table? contact, string? errorCode
local function validateContact(session, data, ignoreId)
    if type(data) ~= 'table' then return nil, 'invalid' end

    local name = Util.CleanText(data.name, Config.Contacts.maxName)
    if not name or name == '' then return nil, 'invalid_name' end

    local number = Util.NormalizeNumber(data.number)
    if not number then return nil, 'invalid_number' end

    local avatar = nil
    if data.avatar ~= nil and data.avatar ~= '' then
        if not Nexora.IsImageAllowed(session, data.avatar) then return nil, 'invalid_image' end
        avatar = data.avatar
    end

    for i = 1, #session.contacts do
        local contact = session.contacts[i]
        if contact.number == number and contact.id ~= ignoreId then
            return nil, 'duplicate'
        end
    end

    return {
        name = name,
        number = number,
        avatar = avatar,
        favourite = data.favourite == true,
    }
end

Nexora.RegisterCallback('contacts:list', { app = 'contacts' }, function(session)
    return { ok = true, contacts = session.contacts }
end)

Nexora.RegisterCallback('contacts:add', { app = 'contacts', limit = 'contact' }, function(session, data)
    if #session.contacts >= Config.Contacts.maxContacts then
        return { ok = false, error = 'limit' }
    end

    local contact, err = validateContact(session, data)
    if not contact then return { ok = false, error = err } end

    contact.id = DB.AddContact(session.identifier, contact.name, contact.number, contact.avatar, contact.favourite)
    session.contacts[#session.contacts + 1] = contact

    return { ok = true, contact = contact }
end)

Nexora.RegisterCallback('contacts:update', { app = 'contacts', limit = 'contact' }, function(session, id, data)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    local existing = findContact(session, id)
    if not existing then return { ok = false, error = 'not_found' } end

    local contact, err = validateContact(session, data, id)
    if not contact then return { ok = false, error = err } end

    DB.UpdateContact(session.identifier, id, contact.name, contact.number, contact.avatar, contact.favourite)

    existing.name = contact.name
    existing.number = contact.number
    existing.avatar = contact.avatar
    existing.favourite = contact.favourite

    return { ok = true, contact = existing }
end)

Nexora.RegisterCallback('contacts:delete', { app = 'contacts', limit = 'contact' }, function(session, id)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    local _, index = findContact(session, id)
    if not index then return { ok = false, error = 'not_found' } end

    DB.DeleteContact(session.identifier, id)
    table.remove(session.contacts, index)

    return { ok = true }
end)

-------------------------------------------------------------------------------
-- Notes
-------------------------------------------------------------------------------

Nexora.RegisterCallback('notes:list', { app = 'notes' }, function(session)
    local rows = DB.GetNotes(session.identifier)
    local notes = {}

    for i = 1, #rows do
        local row = rows[i]
        notes[i] = {
            id = row.id,
            title = row.title,
            body = row.body,
            pinned = Util.ToBool(row.pinned),
            ts = tonumber(row.ts),
        }
    end

    return { ok = true, notes = notes }
end)

Nexora.RegisterCallback('notes:save', { app = 'notes', limit = 'note' }, function(session, data)
    if type(data) ~= 'table' then return { ok = false, error = 'invalid' } end

    local title = Util.CleanText(data.title == nil and '' or data.title, Config.Notes.maxTitle)
    local body = Util.CleanText(data.body == nil and '' or data.body, Config.Notes.maxBody, true)

    if not title or not body then return { ok = false, error = 'invalid' } end
    if title == '' and body == '' then return { ok = false, error = 'empty' } end

    local pinned = data.pinned == true
    local id

    if data.id ~= nil then
        id = Util.ToInteger(data.id, 1)
        if not id then return { ok = false, error = 'invalid' } end
        if not DB.NoteExists(session.identifier, id) then return { ok = false, error = 'not_found' } end

        DB.UpdateNote(session.identifier, id, title, body, pinned)
    else
        if DB.CountNotes(session.identifier) >= Config.Notes.maxNotes then
            return { ok = false, error = 'limit' }
        end

        id = DB.InsertNote(session.identifier, title, body, pinned)
    end

    return {
        ok = true,
        note = { id = id, title = title, body = body, pinned = pinned, ts = os.time() },
    }
end)

Nexora.RegisterCallback('notes:delete', { app = 'notes', limit = 'note' }, function(session, id)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    local affected = DB.DeleteNote(session.identifier, id)

    return { ok = (affected or 0) > 0 }
end)

-------------------------------------------------------------------------------
-- Gallery & camera
-------------------------------------------------------------------------------

-- How long a camera upload grant stays valid (ms).
local PHOTO_GRANT_TIME = 45000

---@return table result
local function addImage(session, url)
    if DB.CountGallery(session.identifier) >= Config.Gallery.maxImages then
        return { ok = false, error = 'gallery_full' }
    end

    local id = DB.AddImage(session.identifier, url)

    return { ok = true, image = { id = id, url = url, ts = os.time() } }
end

Nexora.RegisterCallback('gallery:list', { app = 'gallery' }, function(session)
    local rows = DB.GetGallery(session.identifier)
    local images = {}

    for i = 1, #rows do
        images[i] = { id = rows[i].id, url = rows[i].url, ts = tonumber(rows[i].ts) }
    end

    return { ok = true, images = images, max = Config.Gallery.maxImages }
end)

-- Hands the upload target to a client that is about to take a photo. The
-- target lives in server convars so it is never part of the shared config.
Nexora.RegisterCallback('camera:prepare', { app = 'camera', limit = 'gallery' }, function(session)
    local url = GetConvar('nexora_phone_upload_url', '')
    if url == '' then return { ok = false, error = 'upload_not_configured' } end

    if DB.CountGallery(session.identifier) >= Config.Gallery.maxImages then
        return { ok = false, error = 'gallery_full' }
    end

    local token = GetConvar('nexora_phone_upload_token', '')

    session.photoGrant = GetGameTimer() + PHOTO_GRANT_TIME

    return {
        ok = true,
        url = url,
        field = GetConvar('nexora_phone_upload_field', 'files[]'),
        headers = token ~= '' and { Authorization = token } or nil,
        encoding = Config.Gallery.encoding,
        quality = Config.Gallery.quality,
    }
end)

-- source = 'camera' : a photo that was just uploaded (needs a camera grant)
-- source = 'link'   : a pasted link (needs Config.Gallery.allowUrlImport)
Nexora.RegisterCallback('gallery:add', { app = 'gallery', limit = 'gallery' }, function(session, url, source)
    if not Util.IsAllowedUrl(url, Config.Gallery.allowedHosts) then
        return { ok = false, error = 'invalid_image' }
    end

    if source == 'camera' then
        local grant = session.photoGrant
        session.photoGrant = nil

        if not grant or grant < GetGameTimer() then
            return { ok = false, error = 'not_allowed' }
        end
    elseif not Config.Gallery.allowUrlImport then
        return { ok = false, error = 'not_allowed' }
    end

    return addImage(session, url)
end)

-- Saves a picture received in a message to the gallery.
Nexora.RegisterCallback('gallery:saveFromMessage', { app = 'gallery', limit = 'gallery' }, function(session, messageId)
    messageId = Util.ToInteger(messageId, 1)
    if not messageId then return { ok = false, error = 'invalid' } end

    local message = DB.GetMessage(session.number, messageId)

    if not message or message.kind ~= 'image'
        or not Util.IsAllowedUrl(message.attachment, Config.Gallery.allowedHosts)
    then
        return { ok = false, error = 'not_found' }
    end

    return addImage(session, message.attachment)
end)

Nexora.RegisterCallback('gallery:delete', { app = 'gallery', limit = 'gallery' }, function(session, id)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    local affected = DB.DeleteImage(session.identifier, id)

    return { ok = (affected or 0) > 0 }
end)

-------------------------------------------------------------------------------
-- Settings
-------------------------------------------------------------------------------

Nexora.RegisterCallback('settings:set', { limit = 'settings' }, function(session, key, value)
    local valid, clean = Nexora.ValidateSetting(key, value)
    if not valid then return { ok = false, error = 'invalid' } end

    if key == 'customWallpaper' and clean ~= '' and not Nexora.IsImageAllowed(session, clean) then
        return { ok = false, error = 'invalid_image' }
    end

    if key == 'wallpaper' and clean == 'custom' and session.settings.customWallpaper == '' then
        return { ok = false, error = 'invalid' }
    end

    local wasAirplane = session.settings.airplane

    session.settings[key] = clean
    Nexora.QueueSave(session)

    local result = { ok = true, key = key, value = clean }

    -- Leaving airplane mode: report what arrived while the phone was offline.
    if key == 'airplane' and wasAirplane and clean == false then
        result.unread = DB.GetUnreadTotal(session.number)
    end

    return result
end)

Nexora.RegisterCallback('settings:reset', { limit = 'settings' }, function(session)
    session.settings = Nexora.DefaultSettings()
    Nexora.QueueSave(session)

    return { ok = true, settings = session.settings }
end)

-------------------------------------------------------------------------------
-- Notification centre
-------------------------------------------------------------------------------

Nexora.RegisterCallback('notifications:dismiss', { phone = false }, function(session, id)
    id = Util.ToInteger(id, 1)
    if not id then return { ok = false, error = 'invalid' } end

    DB.DeleteNotification(session.identifier, id)

    return { ok = true }
end)

Nexora.RegisterCallback('notifications:clear', { phone = false }, function(session, app)
    if app ~= nil then
        app = Util.CleanText(app, 32)
        if not app or app == '' then return { ok = false, error = 'invalid' } end
    end

    DB.ClearNotifications(session.identifier, app)

    return { ok = true }
end)

-------------------------------------------------------------------------------
-- Clock (alarms)
-------------------------------------------------------------------------------

Nexora.RegisterCallback('clock:saveAlarms', { app = 'clock', limit = 'note' }, function(session, alarms)
    if type(alarms) ~= 'table' or #alarms > Config.Alarms.maxAlarms then
        return { ok = false, error = 'invalid' }
    end

    local clean, seen = {}, {}

    for i = 1, #alarms do
        local alarm = alarms[i]
        if type(alarm) ~= 'table' then return { ok = false, error = 'invalid' } end

        local id = Util.ToInteger(alarm.id, 1, 2147483647)
        local hour = Util.ToInteger(alarm.hour, 0, 23)
        local minute = Util.ToInteger(alarm.minute, 0, 59)
        local label = Util.CleanText(alarm.label == nil and '' or alarm.label, 30)

        if not id or not hour or not minute or not label or seen[id] then
            return { ok = false, error = 'invalid' }
        end

        seen[id] = true

        -- days[1] = Sunday ... days[7] = Saturday; all false = ring once.
        local days = {}
        for day = 1, 7 do
            days[day] = type(alarm.days) == 'table' and alarm.days[day] == true
        end

        clean[#clean + 1] = {
            id = id,
            hour = hour,
            minute = minute,
            label = label,
            enabled = alarm.enabled == true,
            days = days,
        }
    end

    DB.SetAppData(session.identifier, 'clock', { alarms = clean })

    return { ok = true, alarms = clean }
end)
