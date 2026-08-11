#pragma compress 1

#include <amxmodx>
#include <amxmisc>
#include <engine>
#include <zombieplague>

#define MAXPLAYERS 32

new bool: ishooked[32]
new hookorigin[32][3]

new g_laserbeam
new g_ball

new HumanHook[33], ZombieHook[33], HookTime[33]

// Крюк — возможность АДМИНКИ (просьба владельца). Флаг админ-меню «u»
// есть и у полных прав, и у купленной админки, то есть у всех, кто за
// неё заплатил. Квар оставлен, чтобы открыть крюк всем без пересборки.
new cvar_hook_admin

public plugin_init() {
	cvar_hook_admin = register_cvar("zp_hook_admin_only", "1")

	register_clcmd("+free_hook", "free_hook_on")
	register_clcmd("-free_hook", "free_hook_off")
	
	register_event("HLTV", "event_round_start", "a", "1=0", "2=0")
}

public event_round_start(id) {
	for(new i; i < MAXPLAYERS + 1; i++) {
		HumanHook[i] = 0
		ZombieHook[i] = 0
		HookTime[i] = 0
	}
}

public plugin_precache() {
	precache_sound("zm_hot/free_hook.wav")
	
	g_laserbeam = precache_model("sprites/laserbeam.spr")
	g_ball = precache_model("sprites/muz4.spr")
}

public client_disconnect(id)
	remove_hook(id)
public client_putinserver(id)
	remove_hook(id)

public free_hook_on(id) {
	if(!is_user_alive(id))
		return PLUGIN_HANDLED

	if(get_pcvar_num(cvar_hook_admin) && !(get_user_flags(id) & ADMIN_MENU)) {
		client_print_color(id, print_team_default,
			"^x04[ZP]^x01 Крюк — возможность администратора. Повесить на клавишу: bind f +free_hook")
		return PLUGIN_HANDLED
	}
	
	if(zp_get_user_zombie(id)) {
		if(ZombieHook[id] < 0) {
			ZombieHook[id] += 0
		} else {
			return PLUGIN_HANDLED
		}
	} else {
		if(HumanHook[id] < 5) {
			HumanHook[id] += 1
		} else {
			return PLUGIN_HANDLED
		}
	}
	
	get_user_origin(id, hookorigin[id-1], 3)
	
	ishooked[id-1] = true
	
	emit_sound(id, CHAN_STATIC, "zm_hot/free_hook.wav", 1.0, ATTN_NORM, 0, PITCH_NORM)
	HookTime[id] = 100
	set_task(0.1, "hook_task", id, "", 0, "ab")
	hook_task(id)
	
	return PLUGIN_HANDLED
}

public is_hooked(id)
	return ishooked[id-1]

public free_hook_off(id) {
	remove_hook(id)
	
	return PLUGIN_HANDLED
}

public hook_task(id) {
	if(!is_user_connected(id) || !is_user_alive(id) || HookTime[id] == 0) {
		remove_hook(id)
		remove_beam(id)
	} else {
		remove_beam(id)
		draw_hook(id)
	}
	
	HookTime[id] -= 1
	new origin[3], Float: velocity[3]
	get_user_origin(id, origin)
	new distance = get_distance(hookorigin[id-1], origin)
	
	if(distance > 25) {
		velocity[0] = (hookorigin[id-1][0] - origin[0]) * (2.0 * 350 / distance)
		velocity[1] = (hookorigin[id-1][1] - origin[1]) * (2.0 * 350 / distance)
		velocity[2] = (hookorigin[id-1][2] - origin[2]) * (2.0 * 350 / distance)
		
		entity_set_vector(id, EV_VEC_velocity, velocity)
	} else {
		entity_set_vector(id, EV_VEC_velocity, Float: {0.0, 0.0, 0.0})
		remove_hook(id)
	}
}

public draw_hook(id) {
	message_begin(MSG_BROADCAST, SVC_TEMPENTITY)
	write_byte(1)
	write_short(id)
	write_coord(hookorigin[id - 1][0])
	write_coord(hookorigin[id - 1][1])
	write_coord(hookorigin[id - 1][2])
	write_short(g_laserbeam)
	write_byte(0)
	write_byte(0)
	write_byte(1)
	write_byte(40)
	write_byte(50)
	
	if(zp_get_user_zombie(id)) {
		write_byte(0)
		write_byte(0)
		write_byte(0)
	} else {
		write_byte(random_num(0, 255))
		write_byte(random_num(0, 255))
		write_byte(random_num(0, 255))
	}
	
	write_byte(150)
	write_byte(0)
	message_end()
	
	message_begin(MSG_BROADCAST, SVC_TEMPENTITY)
	write_byte(TE_SPRITE)
	write_coord(hookorigin[id - 1][0])
	write_coord(hookorigin[id - 1][1])
	write_coord(hookorigin[id - 1][2])
	write_short(g_ball)
	write_byte(20)
	write_byte(164)
	message_end()
}

public remove_hook(id) {
	if(task_exists(id))
		remove_task(id)
	
	remove_beam(id)
	ishooked[id-1] = false
}

public remove_beam(id) {
	message_begin(MSG_BROADCAST, SVC_TEMPENTITY)
	write_byte(99)
	write_short(id)
	message_end()
}