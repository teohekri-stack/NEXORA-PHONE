--[[---------------------------------------------------------------------------
    Nexora Phone - server core
    Player sessions, phone numbers, rate limiting, the callback wrapper every
    other server file uses, notifications and the public server exports.

    Nothing in here (or in the other server files) talks to a framework
    directly: everything goes through Nexora.Bridge (bridge/server/*.lua).
-----------------------------------------------------------------------------]]

if not Nexora.Bridge then return end

local Util = Nexora.Util
local DB = Nexora.DB
local Bridge = Nexora.Bridge

lib.locale(Config.Locale)

-------------------------------------------------------------------------------
-- State
-------------------------------------------------------------------------------

---@class NexoraSession
---@field source integer
---@field identifier string framework character id (citizenid / identifier / charId)
---@field number string
---@field name string
---@field settings table
---@field battery number
---@field contacts table[]
---@field call integer? id of the call this player is part of
---@field dirty boolean settings / battery changed since the last save

local Sessions = {}         ---@type table<integer, NexoraSession>
local ByNumber = {}         ---@type table<string, integer>
local ByIdentifier = {}     ---@type table<string, integer>
local Loading = {}          ---@type table<integer, promise>
local Limits = {}           ---@type table<integer, table<string, { count: integer, reset: integer }>>
local UnknownNumbers = {}   ---@type table<string, integer> negative lookup cache
local unknownCount = 0

-- Keep the phone number in sync with the one the framework stores itself.
local syncNumber = Config.PhoneNumber.syncWithFramework == true and Bridge.GetCharNumber ~= nil

-------------------------------------------------------------------------------
-- Rate limiting
-------------------------------------------------------------------------------

---Fixed window limiter. Returns false when the player exceeded the bucket.
---@param src integer
---@param bucket? string key of Config.RateLimits
---@return boolean allowed
function Nexora.RateLimit(src, bucket)
    bucket = bucket or 'default'

    local rule = Config.RateLimits[bucket] or Config.RateLimits.default
    local now = GetGameTimer()

    local buckets = Limits[src]
    if not buckets then
        buckets = {}
        Limits[src] = buckets
    end

    local entry = buckets[bucket]
    if not entry or now >= entry.reset then
        buckets[bucket] = { count = 1, reset = now + rule[2] * 1000 }
        return true
    end

    if entry.count >= rule[1] then
        Util.Debug(('player %s hit the "%s" rate limit'):format(src, bucket))
        return false
    end

    entry.count = entry.count + 1
    return true
end

-------------------------------------------------------------------------------
-- Settings
-------------------------------------------------------------------------------

local function isBoolean(value)
    return type(value) == 'boolean', value
end

local function isId(list)
    return function(value)
        return type(value) == 'string' and Util.FindById(list, value) ~= nil, value
    end
end

local function isRange(min, max)
    return function(value)
        local number = Util.ToInteger(value, min, max)
        return number ~= nil, number
    end
end

-- key -> validator returning (valid, sanitisedValue). Keys that are not listed
-- here can never be written by a client.
local SettingRules = {
    theme = function(value)
        return value == 'dark' or value == 'light', value
    end,
    wallpaper = function(value)
        if value == 'custom' then return Config.AllowCustomWallpaper == true, value end
        return type(value) == 'string' and Util.FindById(Config.Wallpapers, value) ~= nil, value
    end,
    customWallpaper = function(value)
        if value == '' then return true, '' end
        if not Config.AllowCustomWallpaper then return false end
        return Util.IsAllowedUrl(value, Config.Gallery.allowedHosts), value
    end,
    accent = isId(Config.Accents),
    frame = isId(Config.Frames),
    ringtone = isId(Config.Sounds.ringtones),
    notificationSound = isId(Config.Sounds.notifications),
    volume = isRange(0, 100),
    scale = isRange(70, 130),
    use24h = isBoolean,
    notifications = isBoolean,
    notificationPreview = isBoolean,
    vibrate = isBoolean,
    doNotDisturb = isBoolean,
    airplane = isBoolean,
    hideCallerId = isBoolean,
    lockScreen = isBoolean,
}

local function defaultSettings()
    local settings = Util.Copy(Config.Defaults)
    settings.customWallpaper = ''
    return settings
end

---Merges stored settings over the defaults, dropping anything invalid.
---@param raw string? JSON from the database
local function loadSettings(raw)
    local settings = defaultSettings()
    if type(raw) ~= 'string' or raw == '' then return settings end

    local ok, stored = pcall(json.decode, raw)
    if not ok or type(stored) ~= 'table' then return settings end

    for key, rule in pairs(SettingRules) do
        if stored[key] ~= nil then
            local valid, value = rule(stored[key])
            if valid then settings[key] = value end
        end
    end

    if settings.wallpaper == 'custom' and settings.customWallpaper == '' then
        settings.wallpaper = Config.Defaults.wallpaper
    end

    return settings
end

---Validates a single setting coming from a client.
---@return boolean valid, any value
function Nexora.ValidateSetting(key, value)
    local rule = type(key) == 'string' and SettingRules[key] or nil
    if not rule then return false end
    return rule(value)
end

function Nexora.DefaultSettings()
    return defaultSettings()
end

local function flushSession(session)
    if not session.dirty then return end
    session.dirty = false

    local ok, err = pcall(DB.SaveSettings, session.identifier, json.encode(session.settings), session.battery)
    if not ok then
        Util.Warn(('could not save phone settings of %s: %s'):format(session.identifier, tostring(err)))
    end
end

---Marks the session as changed and writes it to the database at most once
---every few seconds, however many settings were touched in between.
---@param session NexoraSession
function Nexora.QueueSave(session)
    session.dirty = true
    if session.saveQueued then return end

    session.saveQueued = true

    SetTimeout(5000, function()
        session.saveQueued = false
        -- An unloaded session was already flushed by unloadSession.
        if Sessions[session.source] == session then
            flushSession(session)
        end
    end)
end

-------------------------------------------------------------------------------
-- Phone numbers
-------------------------------------------------------------------------------

local function generateNumber()
    local rules = Config.PhoneNumber

    for _ = 1, 50 do
        local digits = {}
        for i = 1, rules.digits do
            digits[i] = math.random(0, 9)
        end

        local number = (rules.prefix or '') .. table.concat(digits)

        if not ByNumber[number]
            and not DB.GetOwnerByNumber(number)
            and not (syncNumber and Bridge.FindByCharNumber and Bridge.FindByCharNumber(number))
        then
            return number
        end
    end

    error('could not generate a free phone number, increase Config.PhoneNumber.digits')
end

---Works out which number a character owns and makes sure nexora_phones and
---(when the framework keeps one) the framework's own number agree on it.
---@return string number, table? row existing nexora_phones row
local function resolveOwnNumber(src, identifier)
    local row = DB.GetPhone(identifier)
    local number = row and row.phone_number or nil
    local frameworkNumber = syncNumber and Util.NormalizeNumber(Bridge.GetCharNumber(src)) or nil

    if frameworkNumber and frameworkNumber ~= number then
        -- The framework is the source of truth, unless another phone already owns it.
        local owner = DB.GetOwnerByNumber(frameworkNumber)
        if not owner or owner == identifier then
            number = frameworkNumber
        end
    end

    if not number then
        number = generateNumber()
    end

    if not row then
        local created = pcall(DB.CreatePhone, identifier, number, json.encode(defaultSettings()))
        if not created then
            -- Lost a race for the same number: take a fresh one.
            number = generateNumber()
            DB.CreatePhone(identifier, number, json.encode(defaultSettings()))
        end
    elseif row.phone_number ~= number then
        DB.UpdateNumber(identifier, number)
    end

    if syncNumber and frameworkNumber ~= number then
        Bridge.SetCharNumber(src, number)
    end

    return number, row
end

-------------------------------------------------------------------------------
-- Sessions
-------------------------------------------------------------------------------

local function buildSession(src, identifier)
    local number, row = resolveOwnNumber(src, identifier)

    if Config.Notifications.persist then
        DB.TrimNotifications(identifier)
    end

    return {
        source = src,
        identifier = identifier,
        number = number,
        name = Bridge.GetName(src) or ('Citizen %s'):format(identifier),
        settings = loadSettings(row and row.settings or nil),
        battery = Util.Clamp(tonumber(row and row.battery) or 100, 0, 100),
        contacts = DB.GetContacts(identifier),
        call = nil,
        dirty = false,
    }
end

---Returns the phone session of a player, creating it when the character is
---loaded but the session is not there yet. Safe to call concurrently.
---@param src integer
---@return NexoraSession?
function Nexora.GetSession(src)
    local session = Sessions[src]
    if session then return session end

    if Loading[src] then
        return Citizen.Await(Loading[src]) or nil
    end

    if not DB.Ready then return nil end

    local identifier = Bridge.GetIdentifier(src)
    if not identifier then return nil end

    local pending = promise.new()
    Loading[src] = pending

    local ok, result = pcall(buildSession, src, identifier)

    Loading[src] = nil

    if not ok then
        Util.Warn(('could not load the phone of player %s: %s'):format(src, tostring(result)))
        pending:resolve(false)
        return nil
    end

    -- The character may have logged out / switched while we were loading.
    if Bridge.GetIdentifier(src) ~= identifier then
        pending:resolve(false)
        return nil
    end

    Sessions[src] = result
    ByNumber[result.number] = src
    ByIdentifier[identifier] = src
    UnknownNumbers[result.number] = nil

    Util.Debug(('session ready: %s (%s) number %s'):format(result.name, identifier, result.number))

    pending:resolve(result)
    return result
end

---Session lookup without loading.
---@return NexoraSession?
function Nexora.PeekSession(src)
    return Sessions[src]
end

---@return NexoraSession?
function Nexora.GetSessionByNumber(number)
    local src = ByNumber[number]
    return src and Sessions[src] or nil
end

---@return NexoraSession?
function Nexora.GetSessionByIdentifier(identifier)
    local src = ByIdentifier[identifier]
    return src and Sessions[src] or nil
end

local function unloadSession(src)
    Limits[src] = nil

    local session = Sessions[src]
    if not session then return end

    if Nexora.Calls then
        Nexora.Calls.HandleUnload(session)
    end

    Sessions[src] = nil
    if ByNumber[session.number] == src then ByNumber[session.number] = nil end
    if ByIdentifier[session.identifier] == src then ByIdentifier[session.identifier] = nil end

    flushSession(session)

    Util.Debug(('session closed: %s (%s)'):format(session.name, session.identifier))
end

---Finds the character that owns a phone number, online or offline.
---@param number string normalised number
---@return string? identifier, integer? source source when the owner is online
function Nexora.ResolveNumber(number)
    local session = Nexora.GetSessionByNumber(number)
    if session then return session.identifier, session.source end

    local now = GetGameTimer()
    local unknownUntil = UnknownNumbers[number]
    if unknownUntil and unknownUntil > now then return nil end

    local identifier = DB.GetOwnerByNumber(number)

    if not identifier and syncNumber and Bridge.FindByCharNumber then
        identifier = Bridge.FindByCharNumber(number)
    end

    if not identifier then
        -- Remember misses for a minute so guessing numbers cannot hammer the database.
        if unknownCount > 2000 then
            UnknownNumbers = {}
            unknownCount = 0
        end
        if not unknownUntil then unknownCount = unknownCount + 1 end
        UnknownNumbers[number] = now + 60000
        return nil
    end

    return identifier, ByIdentifier[identifier]
end

-------------------------------------------------------------------------------
-- Permission helpers
-------------------------------------------------------------------------------

---Does the player carry the phone item (always true when not required)?
---@param src integer
---@return boolean
function Nexora.HasPhone(src)
    if not Config.RequireItem then return true end

    if type(Config.CustomHasItem) == 'function' then
        local ok, result = pcall(Config.CustomHasItem, src, Config.PhoneItem)
        return ok and result == true
    end

    local ok, result = pcall(Bridge.HasItem, src, Config.PhoneItem)
    return ok and result == true
end

---Checks the job / gang / group restriction of an app for a player.
---@param src integer
---@param app table? entry of Config.Apps
---@return boolean
local function canUseApp(src, app)
    if not app or app.enabled == false then return false end
    if type(app.jobs) ~= 'table' then return true end

    for group, minGrade in pairs(app.jobs) do
        local grade = Bridge.GetGroupGrade(src, group)

        if grade and grade >= (tonumber(minGrade) or 0)
            and (not app.onDuty or Bridge.IsOnDuty(src, group))
        then
            return true
        end
    end

    return false
end

---@param session NexoraSession
---@param appId string
---@return boolean
function Nexora.CanUseApp(session, appId)
    return canUseApp(session.source, Util.GetApp(appId))
end

---Ids of the apps a player may see, in config order.
local function allowedApps(src)
    local apps = {}

    for i = 1, #Config.Apps do
        if canUseApp(src, Config.Apps[i]) then
            apps[#apps + 1] = Config.Apps[i].id
        end
    end

    return apps
end

---May this player use a picture url (wallpaper, avatar, attachment)?
---The host must be whitelisted; when importing by link is disabled the
---picture additionally has to be part of the player's own gallery.
---@param session NexoraSession
---@param url any
---@return boolean
function Nexora.IsImageAllowed(session, url)
    if not Util.IsAllowedUrl(url, Config.Gallery.allowedHosts) then return false end
    if Config.Gallery.allowUrlImport then return true end
    return DB.OwnsImage(session.identifier, url)
end

---False when the player stands in one of the configured dead zones.
---@param src integer
---@return boolean
function Nexora.HasSignal(src)
    local zones = Config.Signal.enabled and Config.Signal.deadZones or nil
    if not zones or #zones == 0 then return true end

    local ped = GetPlayerPed(src)
    if not ped or ped == 0 then return true end

    local coords = GetEntityCoords(ped)
    for i = 1, #zones do
        if #(coords - zones[i].coords) <= zones[i].radius then
            return false
        end
    end

    return true
end

---Can this phone send / call right now?
---@param session NexoraSession
---@return boolean ok, string? errorCode
function Nexora.CanCommunicate(session)
    if session.settings.airplane then return false, 'airplane' end
    if Config.Battery.enabled and Config.Battery.shutdownAtZero and session.battery <= 0 then return false, 'battery' end
    if not Nexora.HasSignal(session.source) then return false, 'no_signal' end
    return true
end

---Can this phone receive live calls / banners right now?
---@param session NexoraSession
---@return boolean
function Nexora.IsReachable(session)
    if session.settings.airplane then return false end
    if Config.Battery.enabled and Config.Battery.shutdownAtZero and session.battery <= 0 then return false end
    if not Nexora.HasPhone(session.source) then return false end
    return Nexora.HasSignal(session.source)
end

-------------------------------------------------------------------------------
-- Callback wrapper
-------------------------------------------------------------------------------

---Registers an ox_lib callback with the checks every phone request needs:
---rate limit, loaded session, phone item, app permission and error isolation.
---@param name string registered as "nexora-phone:<name>"
---@param options? { limit: string?, phone: boolean?, app: string? }
---@param handler fun(session: NexoraSession, ...): table|boolean|nil
function Nexora.RegisterCallback(name, options, handler)
    options = options or {}

    lib.callback.register('nexora-phone:' .. name, function(src, ...)
        if not DB.Ready then
            return { ok = false, error = 'not_ready' }
        end

        if not Nexora.RateLimit(src, options.limit) then
            return { ok = false, error = 'rate_limited' }
        end

        local session = Nexora.GetSession(src)
        if not session then
            return { ok = false, error = 'not_ready' }
        end

        if options.phone ~= false and not Nexora.HasPhone(src) then
            return { ok = false, error = 'no_phone' }
        end

        if options.app and not Nexora.CanUseApp(session, options.app) then
            return { ok = false, error = 'no_access' }
        end

        local ok, result = pcall(handler, session, ...)

        if not ok then
            Util.Warn(('callback "%s" failed for player %s: %s'):format(name, src, tostring(result)))
            return { ok = false, error = 'internal' }
        end

        if type(result) ~= 'table' then
            return { ok = result and true or false }
        end

        return result
    end)
end

-------------------------------------------------------------------------------
-- Notifications
-------------------------------------------------------------------------------

---Delivers a notification to a character's phone. Persisted notifications
---also reach characters that are offline (they see them on their next login).
---@param identifier string
---@param data { app: string?, title: string, body: string?, silent: boolean? }
---@param persist? boolean store it in the notification centre (default true)
---@return boolean delivered
function Nexora.Notify(identifier, data, persist)
    local title = Util.CleanText(data.title, 80)
    if not title or title == '' then return false end

    local body = Util.CleanText(data.body or '', 255) or ''
    local app = Util.CleanText(data.app or 'system', 32) or 'system'

    local id
    if persist ~= false and Config.Notifications.persist then
        local ok, insertId = pcall(DB.AddNotification, identifier, app, title, body)
        if ok then id = insertId end
    end

    local session = Nexora.GetSessionByIdentifier(identifier)
    if not session then
        return id ~= nil
    end

    TriggerClientEvent('nexora-phone:client:notification', session.source, {
        id = id,
        app = app,
        title = title,
        body = body,
        ts = os.time(),
        silent = data.silent == true or not Nexora.IsReachable(session),
    })

    return true
end

-------------------------------------------------------------------------------
-- Core callbacks
-------------------------------------------------------------------------------

-- Everything the UI needs after a character was selected. Requested once per
-- character load (and again after a resource restart).
Nexora.RegisterCallback('bootstrap', { phone = false, limit = 'open' }, function(session)
    local clock = DB.GetAppData(session.identifier, 'clock')

    return {
        ok = true,
        framework = Bridge.name,
        number = session.number,
        name = session.name,
        identifier = session.identifier,
        settings = session.settings,
        battery = session.battery,
        contacts = session.contacts,
        notifications = Config.Notifications.persist and DB.GetNotifications(session.identifier) or {},
        unread = DB.GetUnreadTotal(session.number),
        alarms = clock and type(clock.alarms) == 'table' and clock.alarms or {},
        apps = allowedApps(session.source),
        hasPhone = Nexora.HasPhone(session.source),
        serverTime = os.time(),
    }
end)

-- Asked every time the phone is opened: the item check happens server side
-- (in the wrapper) and the app list is refreshed in case the job changed.
Nexora.RegisterCallback('open', { limit = 'open' }, function(session)
    if Config.Battery.enabled and Config.Battery.shutdownAtZero and session.battery <= 0 then
        return { ok = false, error = 'battery' }
    end

    return { ok = true, apps = allowedApps(session.source) }
end)

-- The client reports its battery level; it has no gameplay value so the value
-- is only clamped, never trusted for anything else.
RegisterNetEvent('nexora-phone:server:battery', function(level)
    local src = source
    local session = Sessions[src]

    if not session or type(level) ~= 'number' or level ~= level then return end
    if not Nexora.RateLimit(src, 'settings') then return end

    session.battery = Util.Clamp(Util.Round(level, 2), 0, 100)
    Nexora.QueueSave(session)
end)

-------------------------------------------------------------------------------
-- Lifecycle (called by the framework bridge)
-------------------------------------------------------------------------------

local function isConnected(src)
    return GetPlayerName(src) ~= nil
end

---A character finished loading.
function Nexora.OnPlayerLoaded(src)
    src = tonumber(src)
    if not src then return end

    -- A leftover session of another character means it never unloaded cleanly.
    local existing = Sessions[src]
    if existing and existing.identifier ~= Bridge.GetIdentifier(src) then
        unloadSession(src)
        TriggerClientEvent('nexora-phone:client:unloaded', src)
    end

    if Nexora.GetSession(src) then
        TriggerClientEvent('nexora-phone:client:loaded', src)
    end
end

---A character logged out, was switched or the player left.
function Nexora.OnPlayerUnloaded(src)
    src = tonumber(src)
    if not src then return end

    unloadSession(src)

    if isConnected(src) then
        TriggerClientEvent('nexora-phone:client:unloaded', src)
    end
end

---The job / gang / groups of a player changed: app permissions depend on it.
function Nexora.OnGroupsChanged(src)
    src = tonumber(src)
    if not src or not Sessions[src] then return end

    TriggerClientEvent('nexora-phone:client:apps', src, allowedApps(src))
end

AddEventHandler('playerDropped', function()
    unloadSession(source)
end)

AddEventHandler('onResourceStop', function(resource)
    if resource ~= Nexora.Resource then return end

    for _, session in pairs(Sessions) do
        flushSession(session)
    end
end)

MySQL.ready(function()
    if not DB.VerifySchema() then return end

    -- Resource (re)started while players are online: rebuild their sessions.
    local players = Bridge.GetPlayers()
    for i = 1, #players do
        Nexora.OnPlayerLoaded(players[i])
    end

    Util.Debug(('server ready (%s)'):format(Bridge.name))
end)

-------------------------------------------------------------------------------
-- Exports
-------------------------------------------------------------------------------

---exports['nexora-phone']:GetFramework() -> 'qb' | 'qbx' | 'esx' | 'ox'
exports('GetFramework', function()
    return Bridge.name
end)

---exports['nexora-phone']:GetPhoneNumber(source) -> string?
exports('GetPhoneNumber', function(src)
    local session = Nexora.GetSession(tonumber(src) or -1)
    return session and session.number or nil
end)

---exports['nexora-phone']:GetSourceByNumber(number) -> integer?
exports('GetSourceByNumber', function(number)
    local normalised = Util.NormalizeNumber(number)
    local session = normalised and Nexora.GetSessionByNumber(normalised) or nil
    return session and session.source or nil
end)

---exports['nexora-phone']:GetIdentifierByNumber(number) -> string?
---Returns the character id (citizenid / ESX identifier / charId) that owns
---a number. Works for offline characters too (performs a database lookup).
exports('GetIdentifierByNumber', function(number)
    local normalised = Util.NormalizeNumber(number)
    if not normalised then return nil end
    return (Nexora.ResolveNumber(normalised))
end)

---exports['nexora-phone']:HasPhone(source) -> boolean
exports('HasPhone', function(src)
    return Nexora.HasPhone(tonumber(src) or -1)
end)

---exports['nexora-phone']:SendNotification(target, title, message, app?) -> boolean
---`target` is a server id (number) or a phone number (string).
exports('SendNotification', function(target, title, message, app)
    local identifier

    if type(target) == 'number' then
        local session = Nexora.GetSession(target)
        identifier = session and session.identifier or nil
    else
        local normalised = Util.NormalizeNumber(target)
        identifier = normalised and Nexora.ResolveNumber(normalised) or nil
    end

    if not identifier then return false end

    return Nexora.Notify(identifier, { app = app or 'system', title = title, body = message })
end)

---exports['nexora-phone']:GetSettings(source) -> table? (read only copy)
exports('GetSettings', function(src)
    local session = Nexora.GetSession(tonumber(src) or -1)
    return session and Util.Copy(session.settings) or nil
end)
