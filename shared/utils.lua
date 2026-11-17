--[[---------------------------------------------------------------------------
    Nexora Phone - shared helpers
    Loaded on both sides. Everything here is pure (no natives that only exist
    on one side) so the same validation rules apply to client and server.
-----------------------------------------------------------------------------]]

Nexora = Nexora or {}
Nexora.Util = Nexora.Util or {}
Nexora.Resource = GetCurrentResourceName()

local Util = Nexora.Util

-------------------------------------------------------------------------------
-- Logging
-------------------------------------------------------------------------------

local function stringify(...)
    local parts = {}
    for i = 1, select('#', ...) do
        local value = select(i, ...)
        parts[#parts + 1] = type(value) == 'table' and json.encode(value) or tostring(value)
    end
    return table.concat(parts, ' ')
end

---Prints only when Config.Debug is enabled.
function Util.Debug(...)
    if not Config.Debug then return end
    print(('^5[%s]^7 %s'):format(Nexora.Resource, stringify(...)))
end

---Always prints. Use for problems a server owner has to know about.
function Util.Warn(...)
    print(('^3[%s] %s^7'):format(Nexora.Resource, stringify(...)))
end

-------------------------------------------------------------------------------
-- Numbers & text
-------------------------------------------------------------------------------

function Util.Clamp(value, min, max)
    if value < min then return min end
    if value > max then return max end
    return value
end

function Util.Round(value, decimals)
    local mult = 10 ^ (decimals or 0)
    return math.floor(value * mult + 0.5) / mult
end

---Strict integer parsing. Rejects NaN, infinity, fractions and junk strings.
---@param value any
---@param min? integer
---@param max? integer
---@return integer?
function Util.ToInteger(value, min, max)
    if type(value) == 'string' then
        if #value > 16 or not value:match('^%-?%d+$') then return nil end
        value = tonumber(value)
    end

    if type(value) ~= 'number' then return nil end
    if value ~= value or value == math.huge or value == -math.huge then return nil end
    if value % 1 ~= 0 then return nil end

    value = math.floor(value)

    if min and value < min then return nil end
    if max and value > max then return nil end

    return value
end

---oxmysql returns TINYINT(1) columns as booleans or as 0 / 1 depending on
---its configuration. This accepts both.
function Util.ToBool(value)
    return value == true or value == 1
end

---1234567 -> "1,234,567"
function Util.GroupDigits(value)
    local digits = ('%d'):format(math.floor(tonumber(value) or 0))
    local sign = ''

    if digits:sub(1, 1) == '-' then
        sign = '-'
        digits = digits:sub(2)
    end

    local grouped = digits:reverse():gsub('(%d%d%d)', '%1,'):reverse()

    return sign .. (grouped:gsub('^,', ''))
end

---Removes leading / trailing whitespace.
function Util.Trim(text)
    return (text:gsub('^%s+', ''):gsub('%s+$', ''))
end

---Normalises user supplied text: strips control characters, trims it and cuts
---it down to `maxLength` characters without splitting a UTF-8 sequence.
---@param value any
---@param maxLength? integer
---@param multiline? boolean keep line breaks and tabs
---@return string? text nil when the value is not a string
function Util.CleanText(value, maxLength, multiline)
    if type(value) ~= 'string' then return nil end

    -- Hard cap before doing any pattern work on attacker controlled input.
    local hardCap = (maxLength or 1024) * 4 + 16
    if #value > hardCap then value = value:sub(1, hardCap) end

    local text = value:gsub('\r\n', '\n'):gsub('\r', '\n')

    if multiline then
        text = text:gsub('[\0-\8\11\12\14-\31\127]', '')
    else
        text = text:gsub('[\0-\31\127]', ' ')
    end

    local length = utf8.len(text)

    if not length then
        -- Not valid UTF-8: keep the printable ASCII part only.
        text = text:gsub('[\128-\255]', '')
        length = #text
    end

    if maxLength and length > maxLength then
        local cut = utf8.offset(text, maxLength + 1)
        text = text:sub(1, (cut or (#text + 1)) - 1)
    end

    return Util.Trim(text)
end

-------------------------------------------------------------------------------
-- Phone numbers
-------------------------------------------------------------------------------

---Turns anything a player may have typed ("555 123-4567", "+5551234567",
---5551234567) into a digits-only string, or nil when it is not a number.
---@param value any
---@return string?
function Util.NormalizeNumber(value)
    if type(value) == 'number' then
        if value ~= value or value < 0 or value > 1e15 or value % 1 ~= 0 then return nil end
        value = ('%d'):format(math.floor(value))
    end

    if type(value) ~= 'string' or #value > 32 then return nil end

    local digits = value:gsub('[%s%-%(%)%.%+]', '')
    if digits == '' or digits:find('%D') then return nil end

    local rules = Config.PhoneNumber
    if #digits < rules.minLength or #digits > rules.maxLength then return nil end

    return digits
end

---Formats a digits-only number for display using Config.PhoneNumber.displayGroups.
---@param number string
---@return string
function Util.FormatNumber(number)
    if type(number) ~= 'string' then return '' end

    local groups = Config.PhoneNumber.displayGroups
    if type(groups) ~= 'table' or #groups == 0 then return number end

    local total = 0
    for i = 1, #groups do total = total + groups[i] end
    if total ~= #number then return number end

    local parts, index = {}, 1
    for i = 1, #groups do
        parts[#parts + 1] = number:sub(index, index + groups[i] - 1)
        index = index + groups[i]
    end

    return table.concat(parts, '-')
end

-------------------------------------------------------------------------------
-- Urls
-------------------------------------------------------------------------------

---Extracts the host of a plain https url. Urls carrying credentials, ports or
---characters that could break out of an attribute are rejected outright.
---@param url any
---@return string?
function Util.ParseHost(url)
    if type(url) ~= 'string' or #url < 12 or #url > 255 then return nil end
    if url:find('[%s%c"\'<>\\`@]') then return nil end

    local host = url:match('^https://([%w%.%-]+)[/%?#]') or url:match('^https://([%w%.%-]+)$')
    if not host or host:sub(1, 1) == '.' or host:sub(-1) == '.' or not host:find('%.') then return nil end

    return host:lower()
end

---True when the url is https and its host is (a sub-domain of) an allowed host.
---@param url any
---@param hosts string[]
---@return boolean
function Util.IsAllowedUrl(url, hosts)
    local host = Util.ParseHost(url)
    if not host or type(hosts) ~= 'table' then return false end

    for i = 1, #hosts do
        local allowed = tostring(hosts[i]):lower()
        if host == allowed or host:sub(-(#allowed + 1)) == '.' .. allowed then
            return true
        end
    end

    return false
end

-------------------------------------------------------------------------------
-- Config lookups
-------------------------------------------------------------------------------

---Finds an entry with a matching `id` in one of the config lists.
---@param list table[]
---@param id any
---@return table?
function Util.FindById(list, id)
    if type(list) ~= 'table' or id == nil then return nil end
    for i = 1, #list do
        if list[i].id == id then return list[i] end
    end
    return nil
end

---@param id string
---@return table?
function Util.GetApp(id)
    return Util.FindById(Config.Apps, id)
end

---Shallow copy of a list / map.
function Util.Copy(source)
    local copy = {}
    for key, value in pairs(source) do copy[key] = value end
    return copy
end
