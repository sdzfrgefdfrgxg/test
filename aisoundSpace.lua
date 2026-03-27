local Players = game:GetService("Players")
local player = Players.LocalPlayer
local vel_x        = 0
local vel_y        = 0
local wander_angle = math.random() * math.pi * 2
local last_target  = nil
local bez_t        = 0
local bez_cx       = 0
local bez_cy       = 0
local bez_end_x    = 0
local bez_end_y    = 0
local enabled      = false
local key_was_down = false

local last_tick = os.clock()
local TARGET_DT = 1 / 240

local keyMap = {
    ['A']=0x41,['B']=0x42,['C']=0x43,['D']=0x44,['E']=0x45,['F']=0x46,['G']=0x47,['H']=0x48,
    ['I']=0x49,['J']=0x4A,['K']=0x4B,['L']=0x4C,['M']=0x4D,['N']=0x4E,['O']=0x4F,['P']=0x50,
    ['Q']=0x51,['R']=0x52,['S']=0x53,['T']=0x54,['U']=0x55,['V']=0x56,['W']=0x57,['X']=0x58,
    ['Y']=0x59,['Z']=0x5A,['0']=0x30,['1']=0x31,['2']=0x32,['3']=0x33,['4']=0x34,['5']=0x35,
    ['6']=0x36,['7']=0x37,['8']=0x38,['9']=0x39,['F1']=0x70,['F2']=0x71,['F3']=0x72,['F4']=0x73,
    ['F5']=0x74,['F6']=0x75,['F7']=0x76,['F8']=0x77,['F9']=0x78,['F10']=0x79,['F11']=0x7A,['F12']=0x7B,
    ['SPACE']=0x20,['TAB']=0x09,['ENTER']=0x0D,['SHIFT']=0x10,['CTRL']=0x11,['ALT']=0x12,
    ['INSERT']=0x2D,['DELETE']=0x2E,['HOME']=0x24,['END']=0x23,['PAGEUP']=0x21,['PAGEDOWN']=0x22,
    ['UP']=0x26,['DOWN']=0x28,['LEFT']=0x25,['RIGHT']=0x27
}

local function getToggleKeyCode()
    local key = string.upper(tostring(_G.settings.toggle_key or 'F'))
    return keyMap[key]
end

local function dist(a, b)
    return math.sqrt((b.x - a.x)^2 + (b.y - a.y)^2 + (b.z - a.z)^2)
end

local function get_cursor()
    local client_folder = game.Workspace.Client
    if not client_folder then return end
    local game_folder = client_folder.Game
    if not game_folder then return end
    for _, cursor in ipairs(game_folder:GetChildren()) do
        if cursor.Name == "Cursor" and #cursor:GetChildren() > 0 then
            return cursor
        end
    end
    return nil
end

local function get_next_square()
    local client_folder = game.Workspace.Client
    if not client_folder then return end
    local game_folder = client_folder.Game
    if not game_folder then return end
    local cursor = get_cursor()
    if not cursor then return end
    local nearest_square = nil
    local nearest_square_distance = math.huge
    for _, square in ipairs(game_folder:GetChildren()) do
        if square:IsA("Part") and square.Name == "" then
            local d = dist(cursor.Position, square.Position)
            if d < nearest_square_distance then
                nearest_square = square
                nearest_square_distance = d
            end
        end
    end
    return nearest_square, nearest_square_distance
end

local function bezier(ax, ay, bx, by, cx, cy, t)
    local mt = 1 - t
    return mt*mt*ax + 2*mt*t*bx + t*t*cx,
           mt*mt*ay + 2*mt*t*by + t*t*cy
end

local function move_mouse(square, dt_scale)
    if not square then return end
    local cursor = get_cursor()
    if not cursor then return end

    local square_screen, on_screen = WorldToScreen(square.Position)
    if not on_screen then return end
    local cursor_screen, cursor_on_screen = WorldToScreen(cursor.Position)
    if not cursor_on_screen then return end

    if math.random() < _G.settings.skip_chance * dt_scale then return end

    local tx = square_screen.X
    local ty = square_screen.Y
    local cx_pos = cursor_screen.X
    local cy_pos = cursor_screen.Y

    local delta_x = tx - cx_pos
    local delta_y = ty - cy_pos
    local pixel_dist = math.sqrt(delta_x*delta_x + delta_y*delta_y)

    if last_target ~= square then
        last_target = square
        bez_t = 0
        bez_end_x = tx
        bez_end_y = ty

        local perp_x = -delta_y
        local perp_y =  delta_x
        local perp_len = math.sqrt(perp_x*perp_x + perp_y*perp_y)
        if perp_len > 0.001 then
            perp_x = perp_x / perp_len
            perp_y = perp_y / perp_len
        end

        local sign = (math.random() > 0.5) and 1 or -1
        local arc_dist = pixel_dist * _G.settings.curve_strength * sign
        bez_cx = (cx_pos + tx) * 0.5 + perp_x * arc_dist
        bez_cy = (cy_pos + ty) * 0.5 + perp_y * arc_dist
    end

    local t_val = math.clamp(pixel_dist / _G.settings.near_threshold, 0, 1)
    local smoothing = _G.settings.smoothing_near
        + (_G.settings.smoothing_far - _G.settings.smoothing_near) * t_val
    local smoothing_scaled = smoothing * dt_scale

    local next_t = math.clamp(bez_t + smoothing_scaled, 0, 1)
    local bx_next, by_next = bezier(cx_pos, cy_pos, bez_cx, bez_cy, bez_end_x, bez_end_y, next_t)
    bez_t = next_t

    local ideal_dx = bx_next - cx_pos
    local ideal_dy = by_next - cy_pos

    local m = _G.settings.momentum ^ dt_scale
    local raw_dx = ideal_dx * (1 - m) + vel_x * m
    local raw_dy = ideal_dy * (1 - m) + vel_y * m

    local jitter_scale = 1 - math.clamp(pixel_dist / _G.settings.near_threshold, 0, 1)
    local jitter_r = jitter_scale * _G.settings.jitter_max * _G.settings.axis_noise * dt_scale
    raw_dx = raw_dx + (math.random() * 2 - 1) * jitter_r
    raw_dy = raw_dy + (math.random() * 2 - 1) * jitter_r

    vel_x = raw_dx
    vel_y = raw_dy

    mousemoverel(raw_dx, raw_dy)
end

task.spawn(function()
    while true and isrbxactive() do
        local now = os.clock()
        local real_dt = math.clamp(now - last_tick, 0, TARGET_DT * 3)
        last_tick = now
        local dt_scale = real_dt / TARGET_DT

        -- Toggle detection (edge trigger: only fires once per press)
        local keycode = getToggleKeyCode()
        if keycode then
            local is_down = iskeypressed(keycode)
            if is_down and not key_was_down then
                enabled = not enabled
                notify(enabled and "ON" or "OFF", "Mouse Script", 1.5)
            end
            key_was_down = is_down
        end

        if enabled then
            local next_square, next_square_distance = get_next_square()

            if next_square and next_square_distance < _G.settings.distance_before_move then
                move_mouse(next_square, dt_scale)
            else
                last_target = nil

                if math.abs(vel_x) > 0.08 or math.abs(vel_y) > 0.08 then
                    local decay = _G.settings.glide_decay ^ dt_scale
                    vel_x = vel_x * decay
                    vel_y = vel_y * decay

                    local speed = math.sqrt(vel_x*vel_x + vel_y*vel_y)
                    local tremor = speed * _G.settings.glide_tremor * dt_scale
                    local tx = vel_x + (math.random() * 2 - 1) * tremor
                    local ty = vel_y + (math.random() * 2 - 1) * tremor
                    mousemoverel(tx, ty)
                else
                    vel_x = 0
                    vel_y = 0
                    wander_angle = wander_angle + _G.settings.wander_speed * dt_scale * (math.random() * 2 - 1)
                    local r = _G.settings.wander_radius * math.random() * dt_scale
                    mousemoverel(math.cos(wander_angle) * r, math.sin(wander_angle) * r)
                end
            end
        else
            -- reset velocity when toggled off so it doesn't carry over
            vel_x = 0
            vel_y = 0
            last_target = nil
        end

        task.wait(1/240)
    end
end)
