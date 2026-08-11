#pragma compress 1

#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>
#include <zombieplague>

new const paramodel[] = "models/zm_hot/parachute.mdl"
new para_ent[33];
new Float:fallingspeed = -75.0;

public plugin_init() {
	RegisterHam(Ham_Spawn, "player", "fw_PlayerSpawn_Post", 1)
	RegisterHam(Ham_Killed, "player", "fw_PlayerKilled")
	register_forward(FM_PlayerPreThink, "fw_PreThink")
}

public plugin_precache() precache_model(paramodel)

public client_disconnect(id) parachute_reset(id)
	
public zp_user_infected_post(id) parachute_reset(id)

public fw_PlayerKilled(victim) parachute_reset(victim)

public fw_PlayerSpawn_Post(id) if (is_user_alive(id)) parachute_reset(id)

public fw_PreThink(id) {	
	if(zp_get_user_zombie(id) || zp_get_user_survivor(id)) return
		
	new Float:frame;
	new button = pev(id, pev_button);
	new oldbutton = pev(id, pev_oldbuttons);
	new flags = pev(id, pev_flags);
	
	if (pev_valid(para_ent[id]) && (flags & FL_ONGROUND)) {
		if (pev(para_ent[id],pev_sequence)!=2) {
			set_pev(para_ent[id], pev_sequence, 2);
			set_pev(para_ent[id], pev_gaitsequence, 1);
			set_pev(para_ent[id], pev_frame, 0.0);
			set_pev(para_ent[id], pev_fuser1, 0.0);
			set_pev(para_ent[id], pev_animtime, 0.0);
			return;
		}
			
		pev(para_ent[id],pev_fuser1, frame);
		frame += 2.0;
		set_pev(para_ent[id],pev_fuser1,frame);
		set_pev(para_ent[id],pev_frame,frame);

		if (frame > 254.0) parachute_reset(id)
		return;
	}
	
	if (button & IN_USE) {
		new Float:velocity[3];
		pev(id, pev_velocity, velocity);
		
		if (velocity[2]<0.0) {
			if(!para_ent[id]) {
				para_ent[id] = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"));
				
				if(para_ent[id]) {
					set_pev(para_ent[id], pev_classname,"parachute");
					set_pev(para_ent[id], pev_aiment, id)
					set_pev(para_ent[id], pev_owner, id);
					set_pev(para_ent[id], pev_movetype, MOVETYPE_FOLLOW);
					engfunc(EngFunc_SetModel, para_ent[id], paramodel);
					set_pev(para_ent[id], pev_sequence, 0);
					set_pev(para_ent[id], pev_gaitsequence, 1);
					set_pev(para_ent[id], pev_frame, 0.0);
					set_pev(para_ent[id], pev_fuser1, 0.0);
				}
			} else {
				set_pev(id, pev_sequence, 3)
				set_pev(id, pev_gaitsequence, 1)
				set_pev(id, pev_frame, 1.0)
				set_pev(id, pev_framerate, 1.0)

				velocity[2] = (velocity[2] + 40.0 < fallingspeed) ? velocity[2] + 40.0 : fallingspeed
				set_pev(id, pev_velocity, velocity)

				if (pev(para_ent[id],pev_sequence)== 0) {
					pev(para_ent[id],pev_fuser1, frame);
					frame += 1.0;
					set_pev(para_ent[id],pev_fuser1,frame);
					set_pev(para_ent[id],pev_frame,frame);

					if (frame > 100.0) {
						set_pev(para_ent[id], pev_animtime, 0.0);
						set_pev(para_ent[id], pev_framerate, 0.4);
						set_pev(para_ent[id], pev_sequence, 1);
						set_pev(para_ent[id], pev_gaitsequence, 1);
						set_pev(para_ent[id], pev_frame, 0.0);
						set_pev(para_ent[id], pev_fuser1, 0.0);
					}
				}
			}
		}
		else 
			parachute_reset(id)
	}
	else if (oldbutton & IN_USE)
		parachute_reset(id)
}

parachute_reset(id) {
	if(pev_valid(para_ent[id])) {
		engfunc(EngFunc_RemoveEntity, para_ent[id]);
		para_ent[id]=false
	}
}