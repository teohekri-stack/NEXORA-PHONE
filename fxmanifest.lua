fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'nexora-phone'
author 'Nexora'
description 'Nexora Phone - a modern smartphone for QBCore, Qbox, ESX and ox_core (ox_lib + oxmysql)'
version '1.0.0'

-- ox_lib must be initialised before any of our own shared code runs.
shared_scripts {
    '@ox_lib/init.lua',
    'config.lua',
    'shared/utils.lua',
    'bridge/shared.lua',
}

-- Every bridge file is listed; each one returns immediately unless it
-- belongs to the framework detected in bridge/shared.lua.
client_scripts {
    'bridge/client/*.lua',
    'client/main.lua',
    'client/nui.lua',
    'client/phone.lua',
    'client/calls.lua',
    'client/camera.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'bridge/server/*.lua',
    'server/database.lua',
    'server/main.lua',
    'server/messages.lua',
    'server/calls.lua',
    'server/apps.lua',
    'server/bank.lua',
}

ui_page 'html/index.html'

files {
    'locales/*.json',
    'html/index.html',
    'html/style.css',
    'html/apps.css',
    'html/app.js',
    'html/apps/*.js',
    'html/assets/**/*',
}

-- The framework (qb-core / qbx_core / es_extended / ox_core) is detected at
-- runtime, so it is not listed here: just start it before this resource.
dependencies {
    '/server:6116',
    '/onesync',
    'ox_lib',
    'oxmysql',
}
