--[[---------------------------------------------------------------------------
    Nexora Phone - configuration
    Everything a server owner normally needs to touch lives in this file.
    The file is loaded on both the client and the server, so never put
    secrets (webhooks, API keys) in here - those belong in server.cfg convars.
-----------------------------------------------------------------------------]]

Config = {}

-------------------------------------------------------------------------------
-- General
-------------------------------------------------------------------------------

-- Which framework the phone runs on.
--   'auto' -> detect (checks qbx_core, qb-core, es_extended, ox_core in that order)
--   'qb'   -> QBCore (qb-core)
--   'qbx'  -> Qbox (qbx_core)
--   'esx'  -> ESX (es_extended, Legacy 1.9+ recommended)
--   'ox'   -> ox_core
-- The framework must be started BEFORE this resource in server.cfg.
Config.Framework = 'auto'

-- Prints verbose diagnostics to the client/server console.
-- Leave off in production.
Config.Debug = false

-- Language file to load from locales/<name>.json (used for Lua-side messages).
Config.Locale = 'en'

-- Branding shown inside the phone UI. Purely cosmetic.
Config.Brand = {
    name = 'Nexora',        -- shown on the lock screen / about page
    device = 'Nexora X1',   -- model name in Settings > About
    carrier = 'NEXORA',     -- carrier label in the status bar
}

-- 'ox'        -> ox_lib notifications (lib.notify)
-- 'framework' -> the framework's own notification (QBCore:Notify, ESX.ShowNotification, ...)
-- Used for messages shown outside the phone UI (e.g. "You don't have a phone").
Config.NotifyProvider = 'ox'

-- Confirmation dialogs (delete a contact, send money, reset settings, ...):
--   false -> drawn inside the phone, matching its theme (default)
--   true  -> ox_lib alert dialogs (lib.alertDialog) in the middle of the screen
Config.UseOxLibDialogs = false

-------------------------------------------------------------------------------
-- Opening the phone
-------------------------------------------------------------------------------

-- Require an inventory item to open the phone. Checked server side.
-- Works out of the box with ox_inventory, qb-inventory (and forks) and the
-- ESX inventory.
Config.RequireItem = true
Config.PhoneItem = 'phone'

-- Using an inventory the phone does not know? Return true/false yourself.
-- Runs on the server only.
--     Config.CustomHasItem = function(source, item)
--         return exports['my-inventory']:HasItem(source, item)
--     end
Config.CustomHasItem = nil

-- Default key (players can rebind it in GTA Settings > Key Bindings > FiveM).
Config.OpenKey = 'M'

-- Optional chat command that also toggles the phone. Set to false to disable.
Config.Command = 'phone'

Config.DisableWhileDead = true      -- cannot open while dead / in last stand
Config.DisableWhileCuffed = true    -- cannot open while handcuffed
Config.AllowWhileDriving = true     -- allow opening as a vehicle driver

-- Let the player keep walking / driving while the phone is open.
-- Mouse look is always disabled while the UI has focus.
Config.KeepInput = true

-------------------------------------------------------------------------------
-- Phone model & animations
-------------------------------------------------------------------------------

Config.Prop = {
    enabled = true,
    model = 'prop_npc_phone_02',
    bone = 28422,                               -- right hand
    offset = vector3(0.0, 0.0, 0.0),
    rotation = vector3(0.0, 0.0, 0.0),
}

Config.Animations = {
    enabled = true,
    -- on foot
    foot = {
        dict = 'cellphone@',
        open = 'cellphone_text_in',
        idle = 'cellphone_text_read_base',
        close = 'cellphone_text_out',
        call = 'cellphone_call_listen_base',
    },
    -- inside a vehicle
    vehicle = {
        dict = 'cellphone@in_car@ds',
        open = 'cellphone_text_in',
        idle = 'cellphone_text_read_base',
        close = 'cellphone_text_out',
        call = 'cellphone_call_listen_base',
    },
}

-------------------------------------------------------------------------------
-- Phone numbers
-------------------------------------------------------------------------------

Config.PhoneNumber = {
    -- When true the phone uses (and keeps in sync) the number the framework
    -- stores for the character, so other resources see the same number:
    --   QBCore / Qbox -> PlayerData.charinfo.phone
    --   ox_core       -> characters.phoneNumber  (player.get('phoneNumber'))
    --   ESX           -> player metadata "phoneNumber" (xPlayer.getMeta), ESX 1.10+
    -- When false Nexora keeps its own number in nexora_phones only.
    syncWithFramework = true,

    -- Generation of brand new numbers (only used when a character has none).
    prefix = '555',     -- fixed digits placed in front ('' for none)
    digits = 7,         -- amount of random digits generated after the prefix

    -- How numbers are grouped when shown in the UI. {3, 3, 4} -> 555-123-4567.
    -- Numbers whose length does not match the groups are shown unformatted.
    displayGroups = { 3, 3, 4 },

    -- Validation of numbers typed by players (digits only, after stripping
    -- spaces, dashes, brackets and a leading +).
    minLength = 3,
    maxLength = 15,
}

-------------------------------------------------------------------------------
-- Apps
--   id        internal id, must match a file in html/apps/<id>.js
--   label     name under the icon
--   enabled   false removes the app for everyone
--   dock      true pins it to the dock (max 4 are shown)
--   jobs      nil = everyone, or a map of name -> minimum grade, e.g.
--             { police = 0, ambulance = 2 }. A name is a job (all frameworks),
--             a gang (QBCore / Qbox) or a group (ox_core).
--   onDuty    when true the player must also be on duty in that job
--             (ox_core: the group has to be the active group)
-------------------------------------------------------------------------------

Config.Apps = {
    { id = 'phone',      label = 'Phone',      enabled = true, dock = true  },
    { id = 'messages',   label = 'Messages',   enabled = true, dock = true  },
    { id = 'contacts',   label = 'Contacts',   enabled = true, dock = true  },
    { id = 'camera',     label = 'Camera',     enabled = true, dock = true  },
    { id = 'gallery',    label = 'Gallery',    enabled = true, dock = false },
    { id = 'bank',       label = 'Bank',       enabled = true, dock = false },
    { id = 'notes',      label = 'Notes',      enabled = true, dock = false },
    { id = 'clock',      label = 'Clock',      enabled = true, dock = false },
    { id = 'calculator', label = 'Calculator', enabled = true, dock = false },
    { id = 'settings',   label = 'Settings',   enabled = true, dock = false },

    -- Example of a job restricted app (uncomment once html/apps/mdt.js exists):
    -- { id = 'mdt', label = 'MDT', enabled = true, dock = false, jobs = { police = 0 }, onDuty = true },
}

-------------------------------------------------------------------------------
-- Appearance
-------------------------------------------------------------------------------

-- Default look for a fresh phone. Players change these in the Settings app.
Config.Defaults = {
    theme = 'dark',             -- 'dark' | 'light'
    accent = 'azure',           -- id from Config.Accents
    wallpaper = 'aurora',       -- id from Config.Wallpapers
    frame = 'graphite',         -- id from Config.Frames
    ringtone = 'aurora',        -- id from Config.Sounds.ringtones
    notificationSound = 'drop', -- id from Config.Sounds.notifications
    volume = 60,                -- 0 - 100
    scale = 100,                -- UI scale in percent (70 - 130)
    use24h = true,
    notifications = true,       -- banner notifications
    notificationPreview = true, -- show message text in banners / lock screen
    vibrate = true,             -- shake animation on incoming call
    doNotDisturb = false,
    airplane = false,           -- blocks calls + messages
    hideCallerId = false,       -- outgoing calls show as "Unknown"
    lockScreen = true,          -- show the lock screen when opening
}

-- Wallpapers. `css` is any valid CSS background value, `image` is a path
-- relative to html/ (or a full https:// url).
Config.Wallpapers = {
    { id = 'aurora',   label = 'Aurora',   image = 'assets/wallpapers/aurora.svg'   },
    { id = 'dunes',    label = 'Dunes',    image = 'assets/wallpapers/dunes.svg'    },
    { id = 'orbit',    label = 'Orbit',    image = 'assets/wallpapers/orbit.svg'    },
    { id = 'tide',     label = 'Tide',     image = 'assets/wallpapers/tide.svg'     },
    { id = 'ember',    label = 'Ember',    css = 'linear-gradient(160deg,#2b0f1a 0%,#8a2b2b 45%,#f0a04b 100%)' },
    { id = 'midnight', label = 'Midnight', css = 'radial-gradient(120% 90% at 50% 0%,#27306b 0%,#0e1030 55%,#05060f 100%)' },
    { id = 'mint',     label = 'Mint',     css = 'linear-gradient(170deg,#d7f5e9 0%,#8fd9c4 50%,#3a9d8f 100%)' },
    { id = 'slate',    label = 'Slate',    css = 'linear-gradient(180deg,#2f3540 0%,#14171d 100%)' },
}

-- Let players use any picture from their gallery as wallpaper.
Config.AllowCustomWallpaper = true

-- Accent colours selectable in Settings.
Config.Accents = {
    { id = 'azure',  label = 'Azure',  color = '#3d8bff' },
    { id = 'violet', label = 'Violet', color = '#8b6cff' },
    { id = 'mint',   label = 'Mint',   color = '#22c79a' },
    { id = 'amber',  label = 'Amber',  color = '#f5a524' },
    { id = 'coral',  label = 'Coral',  color = '#ff6b5e' },
    { id = 'rose',   label = 'Rose',   color = '#f0509b' },
}

-- Phone bodies. `notch`: 'island' | 'notch' | 'punch' | 'none'
Config.Frames = {
    { id = 'graphite', label = 'Graphite', color = '#1b1d22', edge = '#3a3d45', notch = 'island', radius = 46 },
    { id = 'silver',   label = 'Silver',   color = '#d9dce2', edge = '#f4f5f7', notch = 'island', radius = 46 },
    { id = 'ocean',    label = 'Ocean',    color = '#16324f', edge = '#2f5d8a', notch = 'punch',  radius = 42 },
    { id = 'sand',     label = 'Sand',     color = '#c9b79c', edge = '#e6d9c3', notch = 'notch',  radius = 40 },
    { id = 'crimson',  label = 'Crimson',  color = '#5b1420', edge = '#8f2636', notch = 'punch',  radius = 44 },
    { id = 'bare',     label = 'Bare',     color = '#0c0d10', edge = '#17191e', notch = 'none',   radius = 30 },
}

-- Where the phone sits on screen: 'right' | 'left' | 'center'
Config.Position = 'right'

-------------------------------------------------------------------------------
-- Sounds
--   Every tone is synthesised in the browser, so no audio files are shipped.
--   To use your own file add:  { id = 'mine', label = 'Mine', file = 'assets/sounds/mine.ogg' }
--   (html/assets/**/* in fxmanifest.lua already ships anything placed there).
-------------------------------------------------------------------------------

Config.Sounds = {
    ringtones = {
        { id = 'aurora',  label = 'Aurora'  },
        { id = 'pulse',   label = 'Pulse'   },
        { id = 'marimba', label = 'Marimba' },
        { id = 'retro',   label = 'Retro'   },
        { id = 'silent',  label = 'Silent'  },
    },
    notifications = {
        { id = 'drop',   label = 'Drop'   },
        { id = 'glass',  label = 'Glass'  },
        { id = 'tick',   label = 'Tick'   },
        { id = 'silent', label = 'Silent' },
    },
}

-------------------------------------------------------------------------------
-- Status bar
-------------------------------------------------------------------------------

-- 'real' -> the real local time of the player, 'game' -> the in-game clock.
Config.ClockSource = 'game'

Config.Battery = {
    enabled = true,
    drainPerMinute = 0.25,          -- percent per real minute while the phone is open
    idleDrainPerMinute = 0.02,      -- percent per real minute while it is closed
    chargePerMinute = 4.0,          -- percent per real minute while charging
    chargeInVehicle = true,         -- charge while sitting in a running vehicle
    lowWarning = 15,                -- show a low battery notification at this level
    shutdownAtZero = true,          -- an empty battery prevents opening the phone
}

Config.Signal = {
    enabled = true,
    -- Spheres without any reception. Calls and messages fail inside them.
    deadZones = {
        -- { coords = vector3(-1112.0, 4925.0, 218.0), radius = 150.0 },
    },
    -- Reception drops by this many bars inside interiors (0 - 4).
    interiorPenalty = 1,
    -- Reception drops by one bar for every `fadeDistance` metres past
    -- `fullDistance` from the map centre (0 disables the distance model).
    fullDistance = 4500.0,
    fadeDistance = 1500.0,
}

-------------------------------------------------------------------------------
-- Messages
-------------------------------------------------------------------------------

Config.Messages = {
    maxLength = 500,            -- characters per message
    pageSize = 40,              -- messages loaded per request
    allowImages = true,         -- attach gallery pictures
    allowLocation = true,       -- share a GPS location
    -- Deliver messages to players that are offline (stored, shown on login).
    storeOffline = true,
}

-------------------------------------------------------------------------------
-- Calls
-------------------------------------------------------------------------------

Config.Calls = {
    -- 'auto' picks pma-voice or mumble-voip when running, 'none' disables voice
    -- (the call UI still works, useful for testing).
    voice = 'auto',             -- 'auto' | 'pma-voice' | 'mumble-voip' | 'none'
    ringTimeout = 30,           -- seconds before an unanswered call is dropped
    maxDuration = 0,            -- seconds, 0 = unlimited
    allowAnonymous = true,      -- let players hide their caller id
    historyLimit = 60,          -- call log entries returned to the app
}

-------------------------------------------------------------------------------
-- Bank
-------------------------------------------------------------------------------

Config.Bank = {
    -- Money account shown / used for transfers on QBCore, Qbox and ESX.
    -- ox_core always uses the character's default bank account.
    account = 'bank',
    currency = '$',
    minTransfer = 1,
    maxTransfer = 1000000,
    feePercent = 0.0,           -- taken from the sender on top of the amount
    reasonMaxLength = 60,
    historyLimit = 50,          -- transactions returned to the app
    -- Allow transfers to characters that are offline. Safe on ox_core (accounts
    -- live in the database). On QBCore / Qbox / ESX the money is written into
    -- the character's saved data, which those frameworks do not expect - only
    -- enable it if you accept that.
    allowOffline = false,
    -- Allow a citizenid as recipient next to a phone number (QBCore / Qbox only).
    allowCharacterId = true,
    cooldown = 3,               -- seconds between two transfers
}

-------------------------------------------------------------------------------
-- Camera & gallery
-------------------------------------------------------------------------------

Config.Gallery = {
    maxImages = 80,             -- per character

    -- Screenshots need the `screenshot-basic` resource and somewhere to host
    -- the picture. The upload target is read from server convars so it is
    -- only handed to a player at the moment a photo is taken:
    --     set nexora_phone_upload_url "https://api.fivemanage.com/api/image"
    --     set nexora_phone_upload_field "image"
    --     set nexora_phone_upload_token "YOUR_API_KEY"   (optional Authorization header)
    -- See README.md > Camera for Discord / Fivemanage examples.
    screenshotResource = 'screenshot-basic',
    encoding = 'jpg',           -- 'jpg' | 'png' | 'webp'
    quality = 0.85,

    -- Only pictures hosted on these domains are accepted by the server
    -- (sub-domains included). Stops players from injecting arbitrary urls.
    allowedHosts = {
        'cdn.discordapp.com',
        'media.discordapp.net',
        'fivemanage.com',
        'i.imgur.com',
    },

    -- Allow adding a picture to the gallery by pasting a link.
    allowUrlImport = true,
}

Config.Camera = {
    fov = 50.0,
    minFov = 15.0,
    maxFov = 80.0,
    sensitivity = 6.0,
    -- Hide the HUD / radar while the viewfinder is open.
    hideHud = true,
}

-------------------------------------------------------------------------------
-- Notes / contacts / notifications / alarms
-------------------------------------------------------------------------------

Config.Notes = {
    maxNotes = 60,
    maxTitle = 60,
    maxBody = 4000,
}

Config.Contacts = {
    maxContacts = 200,
    maxName = 40,
}

Config.Notifications = {
    persist = true,             -- keep missed notifications in the database
    maxStored = 40,             -- per character
    bannerTime = 4500,          -- ms a banner stays on screen
    -- Show a small banner on screen for calls / messages while the phone is closed.
    showWhenClosed = true,
}

Config.Alarms = {
    maxAlarms = 12,
}

-------------------------------------------------------------------------------
-- Rate limits (server side, per player)
--   { count, seconds } -> at most `count` requests every `seconds`
-------------------------------------------------------------------------------

Config.RateLimits = {
    default  = { 30, 10 },      -- any callback without its own entry
    message  = { 6, 10 },
    call     = { 4, 15 },
    transfer = { 3, 10 },
    contact  = { 15, 10 },
    note     = { 15, 10 },
    gallery  = { 8, 10 },
    settings = { 30, 10 },
    open     = { 10, 10 },
}
