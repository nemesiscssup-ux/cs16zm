#include <amxmodx>
#include <engine>
#include <fakemeta_util>
#include <hamsandwich>
#include <zombieplague>
#include <fun>
#include <dhudmessage>

#define PLUGIN "[CSO:Hunter Zombie]"
#define VERSION "1.2"
#define AUTHOR "HoRRoR/tERoR/Opo4uMapy"


// Zombie Attributes
new const zclass_name[] = "Ганимед"
new const zclass_info[] = "\rРазгон (G) \yVIP"
new const zclass_model[] = "zm_hot_z_deimos" // model
new const zclass_clawmodel[] = "v_strong_deimos2_fix.mdl" // claw model
const zclass_health = 3000 // health
const zclass_speed = 245 // speed
const Float:zclass_gravity = 0.79 // gravity
const Float:zclass_knockback =  0.49 // knockback

// --- config ------------------------ //
#define TRAIL_LIFE        0
#define TRAIL_WIDTH       10
#define TRAIL_RED         200
#define TRAIL_GREEN       0
#define TRAIL_BLUE        0
#define TRAIL_BRIGTHNESS  220

const g_fastspeed = 2000.0 // sprint speed
const g_normspeed = 245.0 // norm speed. must be as zclass_speed


const g_abilonecooldown = 30 // cooldown time
new Float:g_abilonelenght = 3.0 // time of sprint

new const sound_hunter_sprint[] = "zm_hot/hunter_start.wav" // sprint sound
new const sound_hunter_endspr[] = "zm_hot/hunter_end2.wav" // end sound
// ----------------------------------- //

new i_cooldown_time[33]
new g_zclass_hunter
new g_speeded[33] = false
new g_abil_one_used[33] = 0
new gTrail
new g_maxplayers

public plugin_precache()
{
	g_zclass_hunter = zp_register_zombie_class(zclass_name, zclass_info, zclass_model, zclass_clawmodel, zclass_health, zclass_speed, zclass_gravity, zclass_knockback)	
	precache_sound(sound_hunter_sprint)
	precache_sound(sound_hunter_endspr)
}

public plugin_init() 
{
	register_plugin(PLUGIN, VERSION, AUTHOR)
	register_clcmd("drop", "use_ability_one")
	register_forward( FM_PlayerPreThink, "client_prethink" )
	register_logevent("roundStart", 2, "1=Round_Start")
	
	g_maxplayers = get_maxplayers()

	gTrail = engfunc(EngFunc_PrecacheModel,"sprites/zm_hot/cso_trailv2.spr")

	// Словарь донора не переносим — тексты ниже свои
}

public zp_user_infected_post(id, infector)
{
	if(zp_get_user_zombie_class(id) == g_zclass_hunter && zp_get_user_zombie(id) && !zp_get_user_nemesis(id))
	{
		color_chat(id, "!g[Вспышка эпидемии]!y Способность класса: !gРазгон!y — клавиша !gG!y.")

		g_abil_one_used[id] = 0
		g_speeded[id] = 0

		remove_task(id + 666)
	}
}
public client_prethink(id)
{
	if (zp_get_user_zombie_class(id) == g_zclass_hunter)
	{
		if(is_user_alive(id) && zp_get_user_zombie(id) && (zp_get_user_zombie_class(id) == g_zclass_hunter) && !zp_get_user_nemesis(id))
		Action(id);
	}
}

public Action(id)
{
	if (g_speeded[id] == 1)
	{
		set_user_maxspeed(id , g_fastspeed); 
	}
	else
	{
		set_user_maxspeed(id , g_normspeed); 
	}
    	return PLUGIN_HANDLED;
} 

public roundStart()
{
	for (new i = 1; i <= g_maxplayers; i++)
	{
		i_cooldown_time[i] = g_abilonecooldown
		g_abil_one_used[i] = 0
		g_speeded[i] = false
		remove_task(i + 666)
		client_cmd(i,"cl_forwardspeed 400")
		client_cmd(i,"cl_backspeed 400")
	}
}

public plugin_natives ()
	register_native("zp_hunter_speed", "native_zp_hunter_speed", 1)

public native_zp_hunter_speed(id)
	return g_speeded[id]

public use_ability_one(id)
{
	if (is_user_alive(id) && zp_get_user_zombie_class(id) == g_zclass_hunter && zp_get_user_zombie(id) && !zp_get_user_nemesis(id))
	{
		if(g_abil_one_used[id] == 0)
		{
			fm_set_rendering(id, kRenderFxGlowShell, 170, 0, 0, kRenderNormal, 0)
			g_speeded[id] = true

			client_cmd(id,"cl_forwardspeed 1600")
			client_cmd(id,"cl_backspeed 1600")

			//red_screen(id)
			emit_sound(id, CHAN_STREAM, sound_hunter_sprint, 1.0, ATTN_NORM, 0, PITCH_NORM)
			g_abil_one_used[id] = 1
			set_task(g_abilonelenght, "set_normal_speed", id)

			message_begin (MSG_BROADCAST,SVC_TEMPENTITY)
			write_byte (TE_BEAMFOLLOW)
			write_short (id)
			write_short (gTrail)
			write_byte (TRAIL_LIFE)
			write_byte (TRAIL_WIDTH)
			write_byte (TRAIL_RED)
			write_byte (TRAIL_GREEN)
			write_byte (TRAIL_BLUE)
			write_byte (TRAIL_BRIGTHNESS)
			message_end()
	
			message_begin(MSG_ONE, get_user_msgid("SetFOV"), {0,0,0}, id)
			write_byte(110)
			message_end()
			// FOV Effect
				
			message_begin(MSG_ONE,get_user_msgid("ScreenFade"), _, id)
			write_short(7007)
			write_short(7007)
			write_short(0x0000)
			write_byte(255)
			write_byte(0)
			write_byte(0)
			write_byte(125)
			message_end()
			// Red Screen
				
			message_begin(MSG_ONE_UNRELIABLE, get_user_msgid("ScreenShake"), _, id)
			write_short((1<<12)*10) // amplitude             
			write_short((1<<12)*8) // duration
			write_short((1<<12)*10) // frequency
			message_end()
						
			i_cooldown_time[id] = g_abilonecooldown

			set_task(1.0, "ShowHUD", id + 666, _, _, "a", i_cooldown_time[id])
		}		
	}
}

public ShowHUD(taskid)
{
	new id = taskid - 666

	if(!is_user_alive(id))
	{
		remove_task(id + 666)
		return
	}

	--i_cooldown_time[id]

	if(i_cooldown_time[id] > 0)
	{
		set_dhudmessage(200, 100, 0,  0.80, 0.87, 0, 1.0, 1.1, 0.0, 0.0)
		show_dhudmessage(id, "Откат: %d", i_cooldown_time[id])
	}
	else
	{
		remove_task(id + 666)

		g_abil_one_used[id] = 0
		color_chat(id, "!g[Вспышка эпидемии]!y Способность готова.")
	}
}

public set_normal_speed(id)
{
	if ((zp_get_user_zombie_class(id) == g_zclass_hunter) && zp_get_user_zombie(id) && !zp_get_user_nemesis(id))
	{
		fm_set_user_rendering(id)
		emit_sound(id, CHAN_STREAM, sound_hunter_endspr, 1.0, ATTN_NORM, 0, PITCH_NORM)
		g_speeded[id] = false
		//set_pev(id, pev_maxspeed, 257.0)
		client_cmd(id,"cl_forwardspeed 400")
		client_cmd(id,"cl_backspeed 400")
		message_begin(MSG_ONE, get_user_msgid("SetFOV"), {0,0,0}, id)
		write_byte(90)
		message_end()
	}
}

red_screen(const id, const iFade = 1)
{ 
	message_begin(MSG_ONE,get_user_msgid("ScreenFade"),_,id)
	write_short(8192 * iFade)
	write_short(8192 * iFade)
	write_short(0x0000)
	write_byte(255)
	write_byte(0)
	write_byte(0)
	write_byte(125)
	message_end()
}

public zp_user_humanized_post(id)
{
	fm_set_user_rendering(id)
	g_speeded[id] = false
	remove_task(id + 666)
	client_cmd(id,"cl_forwardspeed 400")
	client_cmd(id,"cl_backspeed 400")
	if(g_speeded[id]) 
	{
		message_begin(MSG_ONE, get_user_msgid("SetFOV"), {0,0,0}, id)
		write_byte(90)
		message_end()
	}
}

stock color_chat(const id, const input[], any:...)
{
	new count = 1, players[32];
	static msg[191];
	vformat(msg, 190, input, 3);
	
	replace_all(msg, 190, "!g", "^4");
	replace_all(msg, 190, "!y", "^1");
	replace_all(msg, 190, "!t", "^3");
	
	if (id) players[0] = id; else get_players(players, count, "ch");
	{
		for (new i = 0; i < count; i++)
		{
			if (is_user_connected(players[i]))
			{
				message_begin(MSG_ONE_UNRELIABLE, get_user_msgid("SayText"), _, players[i]);
				write_byte(players[i]);
				write_string(msg);
				message_end();
			}
		}
	}
}