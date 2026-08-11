#include <amxmodx>
#include <engine>
#include <fakemeta>
#include <fun>
#include <xs>
#include <hamsandwich>
#include <zombieplague>

// Zombie Attributes
new const zclass_name[] = "Шаман"
new const zclass_info[] = "\rГипноз (R)"
new const zclass_model[] = "zm_hot_z_siren" // model
new const zclass_clawmodel[] = "v_strong_siren3.mdl" // claw model
new const zclass_ring_sprite[] = "sprites/shockwave.spr" // ring sprite
new const zclass_screamsounds[][] = { "zm_hot/shaman-scream.wav" } // scream sound

// Scream ring color		R	G	B
new zclass_ring_colors[3] = {	200,	0,	0	}

const zclass_health = 3200 // health
const zclass_speed = 255 // speed

const Float:zclass_gravity = 0.8 // gravity
const Float:zclass_knockback =  0.49 // knockback

// Variables
new g_ishamanZID, g_iMaxPlayers, g_msgSayText, g_msgScreenFade, g_msgScreenShake,
g_msgBarTime, g_sprRing

// Arrays
new g_iPlayerTaskTimes[33]

// Cvar pointers
new cvar_screammode, cvar_duration, cvar_screamdmg, cvar_startime, cvar_reloadtime,
cvar_radius, cvar_damagemode, cvar_slowdown

// Cached cvars
new g_iCvar_ScreamMode, g_iCvar_ScreamDuration, g_iCvar_ScreamDmg, 
g_iCvar_ScreamStartTime, Float:g_flCvar_ReloadTime, Float:g_flCvar_Radius,
g_iCvar_DamageMode, Float:g_flCvar_ScreamSlowdown

// Bools
new bool:g_bIsConnected[33], bool:g_bIsAlive[33], bool:g_bInScreamProcess[33], 
bool:g_bCanDoScreams[33], bool:g_bKilledByScream[33], bool:g_bRoundEnding

// Some constants
const FFADE_IN = 		0x0000
// GIB_NEVER берём из cssdk_const: там верное значение 1
const UNIT_SECOND = 		(1<<12)
const TASK_SCREAM =		37729
const TASK_RELOAD =		55598
const TASK_SCREAMDMG =		48289
const NADE_TYPE_INFECTION = 	1111

// Plug info.
#define PLUG_VERSION "0.1"
#define PLUG_AUTH "meTaLiCroSS"

// Macros
#define is_user_valid_alive(%1) 	(1 <= %1 <= g_iMaxPlayers && g_bIsAlive[%1])
#define is_user_valid_connected(%1) 	(1 <= %1 <= g_iMaxPlayers && g_bIsConnected[%1])
#define zp_get_grenade_type(%1)		(entity_get_int(%1, EV_INT_flTimeStepSound))

/*================================================================================
 [Init, CFG and Precache]
=================================================================================*/

public plugin_init()
{
	// Plugin Info
	register_plugin("[CSO:Shaman Zombie]", PLUG_VERSION, PLUG_AUTH)
		
	// Main events
	register_event("HLTV", "event_RoundStart", "a", "1=0", "2=0")
	
	// Main messages
	register_message(get_user_msgid("DeathMsg"), "message_DeathMsg")
	
	// Fakemeta Forwards
	register_forward(FM_CmdStart, "fw_CmdStart")
	
	RegisterHam(Ham_Killed, "player", "fw_PlayerKilled")
	RegisterHam(Ham_Spawn, "player", "fw_PlayerSpawn_Post", 1)
	
	cvar_screammode = register_cvar("zp_shaman_mode", "0")
	cvar_duration = register_cvar("zp_shaman_scream_duration", "3")
	cvar_screamdmg = register_cvar("zp_shaman_scream_damage", "1.5")
	cvar_startime = register_cvar("zp_shaman_scream_start_time", "1")
	cvar_reloadtime = register_cvar("zp_shaman_scream_reload_time", "20.0")
	cvar_radius = register_cvar("zp_shaman_scream_radius", "250.0")
	cvar_damagemode = register_cvar("zp_shaman_damage_mode", "0")
	cvar_slowdown = register_cvar("zp_shaman_damage_slowdown", "0.4")
	
	g_iMaxPlayers = get_maxplayers()
	g_msgBarTime = get_user_msgid("BarTime")
	g_msgSayText = get_user_msgid("SayText")
	g_msgScreenFade = get_user_msgid("ScreenFade")
	g_msgScreenShake = get_user_msgid("ScreenShake")
}

public plugin_cfg()
{
	cache_cvars()
}

public plugin_precache()
{
	g_ishamanZID = zp_register_zombie_class(zclass_name, zclass_info, zclass_model, zclass_clawmodel, zclass_health, zclass_speed, zclass_gravity, zclass_knockback)	

	g_sprRing = precache_model(zclass_ring_sprite)

	for(new i = 0; i < sizeof zclass_screamsounds; i++) precache_sound(zclass_screamsounds[i])
}
public event_RoundStart()
{
	cache_cvars()
	g_bRoundEnding = false
}

public message_DeathMsg(msg_id, msg_dest, id)
{
	static iAttacker, iVictim
	
	// Get attacker and victim
	iAttacker = get_msg_arg_int(1)
	iVictim = get_msg_arg_int(2)
	
	// Non-player attacker or self kill
	if(!is_user_connected(iAttacker) || iAttacker == iVictim)
		return PLUGIN_CONTINUE
		
	// Killed by shaman scream
	if(g_bKilledByScream[iVictim])
		set_msg_arg_string(4, "shaman scream")
		
	return PLUGIN_CONTINUE
}

public client_putinserver(id)
{
	g_bIsConnected[id] = true
}

public client_disconnect(id)
{
	g_bIsAlive[id] = false
	g_bIsConnected[id] = false
}

public fw_PlayerSpawn_Post(id)
{
	if(!is_user_alive(id)) return HAM_IGNORED

	g_bIsAlive[id] = true

	stop_scream_task(id)

	if(zp_get_user_zombie(id) && zp_get_user_zombie_class(id) == g_ishamanZID)
		g_bCanDoScreams[id] = true
	else
		g_bCanDoScreams[id] = false
		g_iPlayerTaskTimes[id] = 0

	remove_task(id+TASK_RELOAD)
	remove_task(id+TASK_SCREAMDMG)
	
	return HAM_IGNORED
}

public fw_PlayerKilled(victim, attacker, shouldgib)
{
	// Player victim
	if(is_user_valid_connected(victim))
	{
		// Victim is not alive
		g_bIsAlive[victim] = false
		
		// Reset player vars and tasks
		stop_scream_task(victim)
		
		g_bCanDoScreams[victim] = false
		g_iPlayerTaskTimes[victim] = 0
		
		remove_task(victim+TASK_RELOAD)
		remove_task(victim+TASK_SCREAMDMG)
		
		return HAM_HANDLED
	}
	
	return HAM_IGNORED
}

public fw_CmdStart(id, handle, random_seed)
{
	// Not alive
	if(!is_user_alive(id))
		return FMRES_IGNORED;
	
	// Isn't a zombie?
	if(!zp_get_user_zombie(id) || zp_get_user_nemesis(id))
		return FMRES_IGNORED;
		
	// Invalid class id
	if(zp_get_user_zombie_class(id) != g_ishamanZID)
		return FMRES_IGNORED;
		
	// Get user old and actual buttons
	static iInUseButton, iInUseOldButton
	iInUseButton = (get_uc(handle, UC_Buttons) & IN_RELOAD)
	iInUseOldButton = (get_user_oldbutton(id) & IN_RELOAD)
	
	// Pressing +use button
	if(iInUseButton)
	{
		if(!iInUseOldButton && g_bCanDoScreams[id] && !task_exists(id+TASK_SCREAMDMG) && !g_bRoundEnding)
		{
			// A bar appears in his screen
			message_begin(MSG_ONE, g_msgBarTime, _, id)
			write_byte(g_iCvar_ScreamStartTime) // time
			write_byte(0) // unknown
			message_end()
			
			// Update bool
			g_bInScreamProcess[id] = true
			
			// Next scream time
			set_task(g_iCvar_ScreamStartTime + 0.2, "task_do_scream", id+TASK_SCREAM)
			
			return FMRES_HANDLED
		}
	}
	else
	{
		// Last used button it's +use
		if(iInUseOldButton && g_bInScreamProcess[id])
		{
			// Stop scream main task
			stop_scream_task(id)
			
			return FMRES_HANDLED
		}
	}
	
	return FMRES_IGNORED
}

public task_do_scream(id)
{
	// Normalize task
	id -= TASK_SCREAM
	
	// Do scream sound
	emit_sound(id, CHAN_VOICE, zclass_screamsounds[random_num(0, sizeof zclass_screamsounds - 1)], 1.0, ATTN_NORM, 0, PITCH_NORM)
	
	// Block screams
	g_bCanDoScreams[id] = false
	
	// Reload task
	set_task(g_flCvar_ReloadTime, "task_reload_scream", id+TASK_RELOAD)
	
	// Scream damage task
	set_task(0.1, "task_scream_process", id+TASK_SCREAMDMG, _, _, "b")
}

public task_reload_scream(id)
{
	// Normalize taks
	id -= TASK_RELOAD
	
	// Can do screams again
	g_bCanDoScreams[id] = true
	
	// Message
	client_printcolor(id, "/g[CSO ZM] /yСпособность /g^"[Крик]^"/y | Кнопка /g[R]/y")
}

public task_scream_process(id)
{
	// Normalize task
	id -= TASK_SCREAMDMG
	
	// Time exceed
	if(g_iPlayerTaskTimes[id] >= (g_iCvar_ScreamDuration*10) || g_bRoundEnding)
	{
		// Remove player task
		remove_task(id+TASK_SCREAMDMG)
		
		// Reset task times count
		g_iPlayerTaskTimes[id] = 0
		
		return;
	}
	
	// Update player task time
	g_iPlayerTaskTimes[id]++
	
	// Get player origin
	static Float:flOrigin[3]
	entity_get_vector(id, EV_VEC_origin, flOrigin)
	
	// Collisions
	static iVictim
	iVictim = -1
	
	// Vector var
	static Float:flVictimOrigin[3]
	
	// A ring effect
	engfunc(EngFunc_MessageBegin, MSG_PVS, SVC_TEMPENTITY, flOrigin, 0)
	write_byte(TE_BEAMCYLINDER) // TE id
	engfunc(EngFunc_WriteCoord, flOrigin[0]) // x
	engfunc(EngFunc_WriteCoord, flOrigin[1]) // y
	engfunc(EngFunc_WriteCoord, flOrigin[2]) // z
	engfunc(EngFunc_WriteCoord, flOrigin[0]) // x axis
	engfunc(EngFunc_WriteCoord, flOrigin[1]) // y axis
	engfunc(EngFunc_WriteCoord, flOrigin[2] + g_flCvar_Radius) // z axis
	write_short(g_sprRing) // sprite
	write_byte(0) // startframe
	write_byte(0) // framerate
	write_byte(10) // life
	write_byte(25) // width
	write_byte(0) // noise
	write_byte(zclass_ring_colors[0]) // red
	write_byte(zclass_ring_colors[1]) // green
	write_byte(zclass_ring_colors[2]) // blue
	write_byte(200) // brightness
	write_byte(0) // speed
	message_end()
	
	// Screen effects for him self
	screen_effects(id)
	
	// Do scream effects
	while((iVictim = find_ent_in_sphere(iVictim, flOrigin, g_flCvar_Radius)) != 0)
	{
		// Non-player entity
		if(!is_user_valid_connected(iVictim))
		{
			// Validation check
			if(is_valid_ent(iVictim))
			{
				// Get entity classname
				static szClassname[33]
				entity_get_string(iVictim, EV_SZ_classname, szClassname, charsmax(szClassname))
				
				// It's a grenade, and isn't an Infection Bomb
				if(equal(szClassname, "grenade") && zp_get_grenade_type(iVictim) != NADE_TYPE_INFECTION)
				{
					// Get grenade origin
					entity_get_vector(iVictim, EV_VEC_origin, flVictimOrigin)
					
					// Do a good effect
					engfunc(EngFunc_MessageBegin, MSG_PVS, SVC_TEMPENTITY, flVictimOrigin, 0)
					write_byte(TE_PARTICLEBURST) // TE id
					engfunc(EngFunc_WriteCoord, flVictimOrigin[0]) // x
					engfunc(EngFunc_WriteCoord, flVictimOrigin[1]) // y
					engfunc(EngFunc_WriteCoord, flVictimOrigin[2]) // z
					write_short(45) // radius
					write_byte(108) // particle color
					write_byte(10) // duration * 10 will be randomized a bit
					message_end()
					
					// Remove it
					remove_entity(iVictim)
				}
			}
			
			continue;
		}
			
		// Not alive, zombie or with Godmode
		if(!g_bIsAlive[iVictim] || zp_get_user_zombie(iVictim) || get_user_godmode(iVictim))
			continue;
			
		// Screen effects for victims
		screen_effects(iVictim)
			
		// Get scream mode
		switch(g_iCvar_ScreamMode)
		{
			// Do damage
			case 0:
			{
				// Get human health
				static iHealth
				iHealth = get_user_health(iVictim)
				
				// It's going to die and can be infected?
				if((iHealth - g_iCvar_ScreamDmg) <= 0 && g_iCvar_DamageMode)
				{
					// Can be infected?
					if(zp_infect_user(iVictim, id, 0, 1))
						continue
				}
				
				// It's going to die
				if(iHealth - g_iCvar_ScreamDmg <= 0)
				{
					// Be infected when it's going to die
					if(g_iCvar_DamageMode /* == 1*/)
					{
						// Returns 1 on sucess...
						if(zp_infect_user(iVictim, id, 0, 1))
							continue
					}
	
					// Kill it
					scream_kill(iVictim, id)
					
					continue
				}
				
				// Do fake damage
				set_user_health(iVictim, iHealth - g_iCvar_ScreamDmg)
				
				// Scream slowdown, first should be enabled
				if(g_flCvar_ScreamSlowdown > 0.0)
				{
					// Get his current velocity vector
					static Float:flVelocity[3]
					get_user_velocity(iVictim, flVelocity)
					
					// Multiply his velocity by a number
					xs_vec_mul_scalar(flVelocity, g_flCvar_ScreamSlowdown, flVelocity)
					
					// Set his new velocity vector
					set_user_velocity(iVictim, flVelocity)	
				}
			}
			
			// Instantly Infect
			case 1:
			{
				// Can be infected?
				if(!zp_infect_user(iVictim, id, 0, 1))
				{
					// Kill it
					scream_kill(iVictim, id)
				}
			}
			
			// Instantly Kill
			case 2:
			{
				// Kill it
				scream_kill(iVictim, id)
			}
		}
			
	}
}

public zp_user_infected_post(id, infector)
{
	// It's the selected zombie class
	if(zp_get_user_zombie_class(id) == g_ishamanZID && !zp_get_user_nemesis(id))
	{
		// Array
		g_bCanDoScreams[id] = true
		
		// Message
		client_printcolor(id, "/g[CSO ZM] /yСпособность /g[Крик]/y | Кнопка /g^"[R]^"/y для использования")
	}
}

public zp_user_humanized_post(id)
{
	// Reset player vars and tasks
	stop_scream_task(id)
	
	g_bCanDoScreams[id] = false
	g_iPlayerTaskTimes[id] = 0
	
	remove_task(id+TASK_RELOAD)
	remove_task(id+TASK_SCREAMDMG)
}

public zp_round_ended(winteam)
{
	// Update bool
	g_bRoundEnding = true
	
	// Make a loop
	static id
	for(id = 1; id <= g_iMaxPlayers; id++)
	{
		// Valid connected
		if(is_user_valid_connected(id))
		{
			// Remove mainly tasks
			stop_scream_task(id)
			remove_task(id+TASK_RELOAD)
		}
	}
}

stop_scream_task(id)
{
	// Remove the task
	if(task_exists(id+TASK_SCREAM)) 
	{
		remove_task(id+TASK_SCREAM)
	
		// Remove screen's bar
		message_begin(MSG_ONE, g_msgBarTime, _, id)
		write_byte(0) // time
		write_byte(0) // unknown
		message_end()
		
		// Update bool
		g_bInScreamProcess[id] = false
	}
}

screen_effects(id)
{
	// Screen Fade
	message_begin(MSG_ONE_UNRELIABLE, g_msgScreenFade, _, id)
	write_short(UNIT_SECOND*1) // duration
	write_short(UNIT_SECOND*1) // hold time
	write_short(FFADE_IN) // fade type
	write_byte(200) // r
	write_byte(0) // g
	write_byte(0) // b
	write_byte(125) // alpha
	message_end()
	
	// Screen Shake
	message_begin(MSG_ONE_UNRELIABLE, g_msgScreenShake, _, id)
	write_short(UNIT_SECOND*5) // amplitude
	write_short(UNIT_SECOND*1) // duration
	write_short(UNIT_SECOND*5) // frequency
	message_end()
}

cache_cvars()
{
	g_iCvar_ScreamMode = get_pcvar_num(cvar_screammode)
	g_iCvar_ScreamDuration = get_pcvar_num(cvar_duration)
	g_iCvar_ScreamDmg = get_pcvar_num(cvar_screamdmg)
	g_iCvar_ScreamStartTime = get_pcvar_num(cvar_startime)
	g_iCvar_DamageMode = get_pcvar_num(cvar_damagemode)
	g_flCvar_ReloadTime = floatmax(g_iCvar_ScreamDuration+0.0, get_pcvar_float(cvar_reloadtime))
	g_flCvar_Radius = get_pcvar_float(cvar_radius)
	g_flCvar_ScreamSlowdown = get_pcvar_float(cvar_slowdown)
}

scream_kill(victim, attacker)
{
	// To use later in DeathMsg event
	g_bKilledByScream[victim] = true
	
	// Do kill
	ExecuteHamB(Ham_Killed, victim, attacker, GIB_NEVER)
	
	// We don't need this
	g_bKilledByScream[victim] = false
}

stock client_printcolor(id, const input[], any:...)
{
	static iPlayersNum[32], iCount; iCount = 1
	static szMsg[191]
	
	vformat(szMsg, charsmax(szMsg), input, 3)
	
	replace_all(szMsg, 190, "/g", "^4") // green txt
	replace_all(szMsg, 190, "/y", "^1") // orange txt
	replace_all(szMsg, 190, "/ctr", "^3") // team txt
	replace_all(szMsg, 190, "/w", "^0") // team txt
	
	if(id) iPlayersNum[0] = id
	else get_players(iPlayersNum, iCount, "ch")
		
	for (new i = 0; i < iCount; i++)
	{
		if (g_bIsConnected[iPlayersNum[i]])
		{
			message_begin(MSG_ONE_UNRELIABLE, g_msgSayText, _, iPlayersNum[i])
			write_byte(iPlayersNum[i])
			write_string(szMsg)
			message_end()
		}
	}
}