#include <amxmodx>
#include <engine>
#include <fakemeta>
#include <fakemeta_util>
#include <hamsandwich>
#include <cstrike>
#include <fun>
#include <zombieplague>

#define PLUGIN "[CSO] Thunderbolt"
#define VERSION "3.0"
#define AUTHOR "Dias"

#define DAMAGE 1000
#define DEFAULT_AMMO 20
#define RELOAD_TIME 2.67

#define DELAY_SOUND 0.25

#define CSW_THUNDERBOLT CSW_AWP
#define weapon_thunderbolt "weapon_awp"
#define old_event "events/awp.sc"
#define old_w_model "models/w_awp.mdl"
#define WEAPON_SECRETCODE 1234527

#define V_MODEL "models/zm_hot/v_mexanik_thunder.mdl"
#define P_MODEL "models/zm_hot/p_mexanik_thunder.mdl"
#define W_MODEL "models/zm_hot/w_mexanik_thunder.mdl"

new const WeaponSounds[5][] = 
{
	"zm_hot/sfsniper-1.wav",
	"zm_hot/sfsniper_insight1.wav",
	"zm_hot/sfsniper_zoom.wav",
	"zm_hot/sfsniper_idle.wav",
	"zm_hot/sfsniper_draw.wav"
}

enum
{
	TB_ANIM_IDLE = 0,
	TB_ANIM_SHOOT,
	TB_ANIM_DRAW
}

// MACROS
#define Get_BitVar(%1,%2) (%1 & (1 << (%2 & 31)))
#define Set_BitVar(%1,%2) %1 |= (1 << (%2 & 31))
#define UnSet_BitVar(%1,%2) %1 &= ~(1 << (%2 & 31))

new g_Thunderbolt
new g_Had_Thunderbolt, g_Zoomed, g_Aim_HudId
new Float:g_TargetOrigin[3], Float:CheckDelay[33]
new g_Msg_CurWeapon, g_Msg_AmmoX
new g_Beam_SprId, g_Smoke_SprId, g_HamBot_Register, g_Event_Thunderbolt

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)
	
	register_event("CurWeapon", "Event_CurWeapon", "be", "1=1")
	
	register_forward(FM_UpdateClientData, "fw_UpdateClientData_Post", 1)	
	register_forward(FM_PlaybackEvent, "fw_PlaybackEvent")		
	register_forward(FM_SetModel, "fw_SetModel")
	register_forward(FM_CmdStart, "fw_CmdStart")
	
	RegisterHam(Ham_TraceAttack, "player", "fw_TraceAttack_Player")
	RegisterHam(Ham_TraceAttack, "worldspawn", "fw_TraceAttack_World")
	
	RegisterHam(Ham_Item_AddToPlayer, weapon_thunderbolt, "fw_AddToPlayer_Post", 1)
	RegisterHam(Ham_Item_Deploy, weapon_thunderbolt, "fw_Item_Deploy_Post", 1)
	
	g_Msg_CurWeapon = get_user_msgid("CurWeapon")
	g_Msg_AmmoX = get_user_msgid("AmmoX")
	
	g_Aim_HudId = CreateHudSyncObj(8)
}

public plugin_precache()
{
	precache_model(V_MODEL)
	precache_model(P_MODEL)
	precache_model(W_MODEL)
	
	for(new i = 0; i < sizeof(WeaponSounds); i++) 
		engfunc(EngFunc_PrecacheSound, WeaponSounds[i])
	
	g_Beam_SprId =  engfunc(EngFunc_PrecacheModel, "sprites/laserbeam.spr")
	g_Smoke_SprId = engfunc(EngFunc_PrecacheModel, "sprites/wall_puff1.spr")
	
	register_forward(FM_PrecacheEvent, "fw_PrecacheEvent_Post", 1)	
	//g_Thunderbolt = zp_register_extra_item("0", 0, ZP_TEAM_HUMAN)
}

public client_putinserver(id)
{
	if(is_user_bot(id) && !g_HamBot_Register)
	{
		g_HamBot_Register = 1
		set_task(0.1, "Do_RegisterHamBot", id)
	}
}

public Do_RegisterHamBot(id)
{
	RegisterHamFromEntity(Ham_TraceAttack, id, "fw_TraceAttack_Player")
}

public fw_PrecacheEvent_Post(type, const name[])
{
	if(equal(old_event, name)) g_Event_Thunderbolt = get_orig_retval()
}

public zp_extra_item_selected(id, ItemID)
{
	if(ItemID == g_Thunderbolt) get_thunderbolt(id)
}

public zp_user_infected_post(id) Remove_Thunderbolt(id)

public plugin_natives()
	register_native("imperator_thunderbolt", "native_give_weapon_add", 1)
public native_give_weapon_add(id)
	get_thunderbolt(id)

public get_thunderbolt(id)
{
	Set_BitVar(g_Had_Thunderbolt, id)
	UnSet_BitVar(g_Zoomed, id)
	
	fm_give_item(id, weapon_thunderbolt)
	
	static weapon_ent; weapon_ent = fm_find_ent_by_owner(-1, weapon_thunderbolt, id)
	if(pev_valid(weapon_ent)) cs_set_weapon_ammo(weapon_ent, 1)
	
	cs_set_user_bpammo(id, CSW_THUNDERBOLT, DEFAULT_AMMO)
}

public Remove_Thunderbolt(id)
{
	UnSet_BitVar(g_Had_Thunderbolt, id)
	UnSet_BitVar(g_Zoomed, id)
}

public Event_CurWeapon(id)
{
	static CSWID; CSWID = read_data(2)
	if(CSWID != CSW_THUNDERBOLT || !Get_BitVar(g_Had_Thunderbolt, id))
		return
		
	if(cs_get_user_zoom(id) > 1 && !Get_BitVar(g_Zoomed, id)) // Zoom
	{
		set_pev(id, pev_viewmodel2, "")
		Set_BitVar(g_Zoomed, id)
	} else { // Not Zoom
		set_pev(id, pev_viewmodel2, V_MODEL)
		UnSet_BitVar(g_Zoomed, id)
	}
	
	UpdateAmmo(id, -1, cs_get_user_bpammo(id, CSW_THUNDERBOLT))
}

public fw_UpdateClientData_Post(id, sendweapons, cd_handle)
{
	if(!is_user_alive(id))
		return FMRES_IGNORED	
	if(get_user_weapon(id) == CSW_THUNDERBOLT && Get_BitVar(g_Had_Thunderbolt, id))
		set_cd(cd_handle, CD_flNextAttack, get_gametime() + 0.001) 
	
	return FMRES_HANDLED
}

public fw_PlaybackEvent(flags, invoker, eventid, Float:delay, Float:origin[3], Float:angles[3], Float:fparam1, Float:fparam2, iParam1, iParam2, bParam1, bParam2)
{
	if(eventid != g_Event_Thunderbolt)
		return FMRES_IGNORED
	if (!is_user_alive(invoker))
		return FMRES_IGNORED		
	if(get_user_weapon(invoker) != CSW_THUNDERBOLT || !Get_BitVar(g_Had_Thunderbolt, invoker))
		return FMRES_IGNORED
	
	engfunc(EngFunc_PlaybackEvent, flags | FEV_HOSTONLY, invoker, eventid, delay, origin, angles, fparam1, fparam2, iParam1, iParam2, bParam1, bParam2)
	Thunderbolt_Shooting(invoker)

	return FMRES_SUPERCEDE
}

public fw_SetModel(entity, model[])
{
	if(!pev_valid(entity))
		return FMRES_IGNORED
	
	static Classname[64]
	pev(entity, pev_classname, Classname, sizeof(Classname))
	
	if(!equal(Classname, "weaponbox"))
		return FMRES_IGNORED
	
	static id
	id = pev(entity, pev_owner)
	
	if(equal(model, old_w_model))
	{
		static weapon
		weapon = fm_get_user_weapon_entity(entity, CSW_THUNDERBOLT)
		
		if(!pev_valid(weapon))
			return FMRES_IGNORED
		
		if(Get_BitVar(g_Had_Thunderbolt, id))
		{
			UnSet_BitVar(g_Had_Thunderbolt, id)
			
			set_pev(weapon, pev_impulse, WEAPON_SECRETCODE)
			set_pev(weapon, pev_iuser4, cs_get_user_bpammo(id, CSW_THUNDERBOLT))
			
			engfunc(EngFunc_SetModel, entity, W_MODEL)
			
			return FMRES_SUPERCEDE
		}
	}

	return FMRES_IGNORED;
}

public fw_CmdStart(id, UcHandle, Seed)
{
	if(!is_user_alive(id))
		return
	if(get_user_weapon(id) != CSW_THUNDERBOLT || !Get_BitVar(g_Had_Thunderbolt, id))
		return
	if(cs_get_user_zoom(id) <= 1)
		return
	
	if(get_gametime() - DELAY_SOUND > CheckDelay[id])
	{
		static Body, Target
		get_user_aiming(id, Target, Body, 99999)
		
		if(is_user_alive(Target))
		{
			emit_sound(id, CHAN_WEAPON, WeaponSounds[1], VOL_NORM, ATTN_NORM, 0, PITCH_NORM)
			
			set_hudmessage(254, 70, 0, -1.0, -1.0, 0, 0.1, 0.1)
			ShowSyncHudMsg(id, g_Aim_HudId, "+")
		}
		
		CheckDelay[id] = get_gametime()
	}
}

public Thunderbolt_Shooting(id)
{
	set_weapon_anim(id, TB_ANIM_SHOOT)
	emit_sound(id, CHAN_WEAPON, WeaponSounds[0], VOL_NORM, ATTN_NORM, 0, PITCH_NORM)
	
	static Ammo; Ammo = cs_get_user_bpammo(id, CSW_THUNDERBOLT)
	
	Ammo--
	UpdateAmmo(id, -1, Ammo)
	
	if(Ammo <= 0)
	{
		static Ent; Ent = fm_get_user_weapon_entity(id, CSW_THUNDERBOLT)
		if(pev_valid(Ent)) cs_set_weapon_ammo(Ent, 0)
		
		cs_set_user_bpammo(id, CSW_THUNDERBOLT, 0)
	}

	Create_Laser(id, g_TargetOrigin)
	
	// Fixed Shell Eject
	set_pdata_float(id, 111, 99999999.0, 5)

	// Next Attack
	Set_Player_NextAttack(id, CSW_THUNDERBOLT, RELOAD_TIME)
}

public Create_Laser(id, Float:End[3])
{
	static Float:Start[3]
	Stock_Get_Postion(id, 50.0, 5.0, -5.0, Start)
	
	message_begin(MSG_BROADCAST, SVC_TEMPENTITY)
	write_byte(TE_BEAMPOINTS)
	engfunc(EngFunc_WriteCoord, Start[0])
	engfunc(EngFunc_WriteCoord, Start[1])
	engfunc(EngFunc_WriteCoord, Start[2])
	engfunc(EngFunc_WriteCoord, End[0])
	engfunc(EngFunc_WriteCoord, End[1])
	engfunc(EngFunc_WriteCoord, End[2])
	write_short(g_Beam_SprId)
	write_byte(0)
	write_byte(0)
	write_byte(10)
	write_byte(25)
	write_byte(0)
	write_byte(255)
	write_byte(70)
	write_byte(0)
	write_byte(200)
	write_byte(0)
	message_end()	
}

public fw_AddToPlayer_Post(ent, id)
{
	if(pev(ent, pev_impulse) == WEAPON_SECRETCODE)
	{
		Set_BitVar(g_Had_Thunderbolt, id)
		cs_set_user_bpammo(id, CSW_THUNDERBOLT, pev(ent, pev_iuser4))
		
		set_pev(ent, pev_impulse, 0)
	}
}

public fw_TraceAttack_Player(ent, attacker, Float:Damage, Float:fDir[3], ptr, iDamageType)
{
	if(!is_user_alive(attacker))
		return HAM_IGNORED	
	if(get_user_weapon(attacker) != CSW_THUNDERBOLT || !Get_BitVar(g_Had_Thunderbolt, attacker))
		return HAM_IGNORED

	get_tr2(ptr, TR_vecEndPos, g_TargetOrigin)
	SetHamParamFloat(3, float(DAMAGE))
	
	return HAM_HANDLED
}

public fw_TraceAttack_World(ent, attacker, Float:Damage, Float:fDir[3], ptr, iDamageType)
{
	if(!is_user_alive(attacker))
		return HAM_IGNORED	
	if(get_user_weapon(attacker) != CSW_THUNDERBOLT || !Get_BitVar(g_Had_Thunderbolt, attacker))
		return HAM_IGNORED

	get_tr2(ptr, TR_vecEndPos, g_TargetOrigin)
	Make_WorldHitEffect(attacker, ptr)
	
	SetHamParamFloat(3, float(DAMAGE))

	return HAM_HANDLED
}

public fw_Item_Deploy_Post(Ent)
{
	if(!pev_valid(Ent))
		return
		
	static Id; Id = get_pdata_cbase(Ent, 41, 4)
	if(!Get_BitVar(g_Had_Thunderbolt, Id))
		return
		
	UnSet_BitVar(g_Zoomed, Id)
		
	set_pev(Id, pev_viewmodel2, V_MODEL)
	set_pev(Id, pev_weaponmodel2, P_MODEL)	
		
	set_weapon_anim(Id, TB_ANIM_DRAW)
}

public UpdateAmmo(Id, Ammo, BpAmmo)
{
	static weapon_ent; weapon_ent = fm_get_user_weapon_entity(Id, CSW_THUNDERBOLT)
	if(pev_valid(weapon_ent))
	{
		if(BpAmmo > 0) cs_set_weapon_ammo(weapon_ent, 1)
		else cs_set_weapon_ammo(weapon_ent, 0)
	}
	
	engfunc(EngFunc_MessageBegin, MSG_ONE_UNRELIABLE, g_Msg_CurWeapon, {0, 0, 0}, Id)
	write_byte(1)
	write_byte(CSW_THUNDERBOLT)
	write_byte(-1)
	message_end()
	
	message_begin(MSG_ONE_UNRELIABLE, g_Msg_AmmoX, _, Id)
	write_byte(1)
	write_byte(BpAmmo)
	message_end()
	
	cs_set_user_bpammo(Id, CSW_THUNDERBOLT, BpAmmo)
}

public Make_WorldHitEffect(id, TrResult)
{
	// Handle First
	static Float:vecSrc[3], Float:vecEnd[3], TE_FLAG
	
	get_weapon_attachment(id, vecSrc)
	global_get(glb_v_forward, vecEnd)
    
	xs_vec_mul_scalar(vecEnd, 8192.0, vecEnd)
	xs_vec_add(vecSrc, vecEnd, vecEnd)

	get_tr2(TrResult, TR_vecEndPos, vecSrc)
	get_tr2(TrResult, TR_vecPlaneNormal, vecEnd)
    
	xs_vec_mul_scalar(vecEnd, 2.5, vecEnd)
	xs_vec_add(vecSrc, vecEnd, vecEnd)
    
	TE_FLAG |= TE_EXPLFLAG_NODLIGHTS
	TE_FLAG |= TE_EXPLFLAG_NOSOUND
	TE_FLAG |= TE_EXPLFLAG_NOPARTICLES
	
	// Make Spark
	for(new i = 0; i < 3; i++)
	{
		engfunc(EngFunc_MessageBegin, MSG_PAS, SVC_TEMPENTITY, vecEnd, 0)
		write_byte(TE_SPARKS)
		engfunc(EngFunc_WriteCoord, vecEnd[0])
		engfunc(EngFunc_WriteCoord, vecEnd[1])
		engfunc(EngFunc_WriteCoord, vecEnd[2] - 10.0)
		message_end()
	}
	
	// Make Smoke
	engfunc(EngFunc_MessageBegin, MSG_PAS, SVC_TEMPENTITY, vecEnd, 0)
	write_byte(TE_EXPLOSION)
	engfunc(EngFunc_WriteCoord, vecEnd[0])
	engfunc(EngFunc_WriteCoord, vecEnd[1])
	engfunc(EngFunc_WriteCoord, vecEnd[2] - 10.0)
	write_short(g_Smoke_SprId)
	write_byte(2)
	write_byte(50)
	write_byte(TE_FLAG)
	message_end()	
}

stock set_weapon_anim(id, anim)
{
	set_pev(id, pev_weaponanim, anim)
	
	message_begin(MSG_ONE_UNRELIABLE, SVC_WEAPONANIM, {0, 0, 0}, id)
	write_byte(anim)
	write_byte(pev(id, pev_body))
	message_end()
}

stock Stock_Get_Postion(id,Float:forw,Float:right, Float:up,Float:vStart[])
{
	static Float:vOrigin[3], Float:vAngle[3], Float:vForward[3], Float:vRight[3], Float:vUp[3]
	
	pev(id, pev_origin, vOrigin)
	pev(id, pev_view_ofs,vUp) //for player
	xs_vec_add(vOrigin,vUp,vOrigin)
	pev(id, pev_v_angle, vAngle) // if normal entity ,use pev_angles
	
	angle_vector(vAngle,ANGLEVECTOR_FORWARD,vForward) //or use EngFunc_AngleVectors
	angle_vector(vAngle,ANGLEVECTOR_RIGHT,vRight)
	angle_vector(vAngle,ANGLEVECTOR_UP,vUp)
	
	vStart[0] = vOrigin[0] + vForward[0] * forw + vRight[0] * right + vUp[0] * up
	vStart[1] = vOrigin[1] + vForward[1] * forw + vRight[1] * right + vUp[1] * up
	vStart[2] = vOrigin[2] + vForward[2] * forw + vRight[2] * right + vUp[2] * up
} 

stock get_weapon_attachment(id, Float:output[3], Float:fDis = 40.0)
{ 
	static Float:vfEnd[3], viEnd[3] 
	get_user_origin(id, viEnd, 3)  
	IVecFVec(viEnd, vfEnd) 
	
	static Float:fOrigin[3], Float:fAngle[3]
	
	pev(id, pev_origin, fOrigin) 
	pev(id, pev_view_ofs, fAngle)
	
	xs_vec_add(fOrigin, fAngle, fOrigin) 
	
	static Float:fAttack[3]
	
	xs_vec_sub(vfEnd, fOrigin, fAttack)
	xs_vec_sub(vfEnd, fOrigin, fAttack) 
	
	static Float:fRate
	
	fRate = fDis / vector_length(fAttack)
	xs_vec_mul_scalar(fAttack, fRate, fAttack)
	
	xs_vec_add(fOrigin, fAttack, output)
}

stock Set_Player_NextAttack(id, CSWID, Float:NextTime)
{
	static Ent; Ent = fm_get_user_weapon_entity(id, CSWID)
	if(!pev_valid(Ent)) return
	
	set_pdata_float(id, 83, NextTime, 5)
	
	set_pdata_float(Ent, 46 , NextTime, 4)
	set_pdata_float(Ent, 47, NextTime, 4)
	set_pdata_float(Ent, 48, NextTime, 4)
}
