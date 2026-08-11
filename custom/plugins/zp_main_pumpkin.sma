#include <amxmodx>
#include <amxmisc>
#include <engine>
#include <cstrike>
#include <zombieplague>
#include <hamsandwich>
#include <fakemeta_util>
#include <fun>

new const NADE_TYPE_CAMPO = 7000

new const model_grenade[] = "models/zm_hot/v_pumpkin.mdl"
new g_bomb[33]
new g_itemID
new const model[] = "models/zm_hot/sf_pumpkin.mdl"

new const entclas[] = "campo_grenade_forze"
new cvar_flaregrenades
new g_trailSpr
const m_pPlayer = 41

new cvar_push

new g_SayText
new const sprite_grenade_trail[] = "sprites/laserbeam.spr"

public plugin_init() {
	RegisterHam(Ham_Think, "grenade", "fw_ThinkGrenade")
	
	RegisterHam(Ham_Killed, "player", "fw_PlayerKilled")
	
	cvar_flaregrenades = get_cvar_pointer("zp_flare_grenades")
	
	register_forward(FM_SetModel, "fw_SetModel")
	
	RegisterHam(Ham_Item_Deploy, "weapon_smokegrenade", "FwdHamSmokeDeploy", 1)
	
	register_touch(entclas, "player", "entity_touch")
	
	register_event("HLTV", "event_round_start", "a", "1=0", "2=0")
	
	g_SayText = get_user_msgid("SayText")
	
	//g_itemID = zp_register_extra_item("0", 0, ZP_TEAM_HUMAN)
	
	cvar_push = register_cvar("zp_forze_push", "7.5")
}

public event_round_start() {
	remove_entity_name(entclas)
	
	arrayset(g_bomb, false, 33)
}

public plugin_precache() {
	g_trailSpr = engfunc(EngFunc_PrecacheModel, sprite_grenade_trail)
	
	engfunc(EngFunc_PrecacheModel, model_grenade)
	engfunc(EngFunc_PrecacheModel, model)
}

public client_disconnect(id)
	g_bomb[id] = false

public plugin_natives ()
{
	register_native("main_pumpkin", "native_give_weapon_add", 1)
}
public native_give_weapon_add(id)
{
	give_auragrenade(id)
}

public give_auragrenade(id) {
	if(g_bomb[id]) {
		Color(id, "!g[ZM] !yУ вас уже есть !tГр.Аура")
	} else {
		g_bomb[id] = true
		give_item(id, "weapon_smokegrenade")
		
		Color(id, "!g[ZM] !yВы купили !tГр.Аура !yна 1 раунд")
	}
}

public zp_extra_item_selected(player, itemid) {
	if(itemid == g_itemID) {
		if(g_bomb[player]) {
			Color(player, "!g[ZM] !yУ вас уже есть !tГр.Аура")
		} else {
			g_bomb[player] = true
			give_item(player, "weapon_smokegrenade")
			
			Color(player, "!g[ZM] !yВы купили !tГр.Аура !yна 1 раунд")
		}
	}
}

public fw_PlayerKilled(victim, attacker, shouldgib) g_bomb[victim] = false

public fw_ThinkGrenade(entity) {
	if(!pev_valid(entity))
		return HAM_IGNORED
	
	static Float: dmgtime
	pev(entity, pev_dmgtime, dmgtime)
	
	if(dmgtime > get_gametime())
		return HAM_IGNORED
	
	if(pev(entity, pev_flTimeStepSound) == NADE_TYPE_CAMPO)
		crear_ent(entity)
	
	return HAM_SUPERCEDE
}

public FwdHamSmokeDeploy(const iEntity) {
	if(pev_valid(iEntity) != 2)
		return HAM_IGNORED
	
	new id = get_pdata_cbase(iEntity, m_pPlayer, 4)
	
	if(g_bomb[id] && !zp_get_user_zombie(id))
		set_pev(id, pev_viewmodel2, model_grenade)
	
	return HAM_IGNORED
}

public fw_SetModel(entity, const model[]) {
	static Float: dmgtime
	pev(entity, pev_dmgtime, dmgtime)
	
	if(dmgtime == 0.0)
		return
	
	if(equal(model[7], "w_sm", 4)) {
		new owner = pev(entity, pev_owner)
		
		if(!zp_get_user_zombie(owner) && g_bomb[owner]) {
			set_pcvar_num(cvar_flaregrenades, 0)
			
			fm_set_rendering(entity, kRenderFxGlowShell, 0, 255, 255, kRenderNormal, 16)
			
			message_begin(MSG_BROADCAST, SVC_TEMPENTITY)
			write_byte(TE_BEAMFOLLOW)
			write_short(entity)
			write_short(g_trailSpr)
			write_byte(10)
			write_byte(10)
			write_byte(0)
			write_byte(255)
			write_byte(255)
			write_byte(500)
			message_end()
			
			set_pev(entity, pev_flTimeStepSound, NADE_TYPE_CAMPO)
			
			set_task(6.0, "DeleteEntityGrenade", entity)
		}
	}
}

public DeleteEntityGrenade(entity) remove_entity(entity)

public crear_ent(id) {
	set_pcvar_num(cvar_flaregrenades, 1)
	
	new iEntity = create_entity("info_target")
	
	if(!is_valid_ent(iEntity))
		return PLUGIN_HANDLED
	
	new Float: Origin[3]
	entity_get_vector(id, EV_VEC_origin, Origin)
	Origin[2] -= 0.00
	
	entity_set_string(iEntity, EV_SZ_classname, entclas)
	
	entity_set_vector(iEntity, EV_VEC_origin, Origin)
	entity_set_model(iEntity, model)
	entity_set_int(iEntity, EV_INT_solid, SOLID_TRIGGER)
	entity_set_size(iEntity, Float: {-100.0, -100.0, -100.0}, Float: {100.0, 100.0, 100.0})
	entity_set_int(iEntity, EV_INT_renderfx, kRenderFxGlowShell)
	entity_set_int(iEntity, EV_INT_rendermode, kRenderTransAlpha)
	entity_set_float(iEntity, EV_FL_renderamt, 50.0)
	
	if(is_valid_ent(iEntity)) {
		new Float: vColor[3]
		
		for(new i; i < 3; i++)
			vColor[i] = random_float(0.0, 255.0)
		
		entity_set_vector(iEntity, EV_VEC_rendercolor, vColor)
	}
	
	static attacker
	attacker = pev(id, pev_owner)
	
	g_bomb[attacker] = false
	
	return PLUGIN_CONTINUE
}

public zp_user_infected_post(infected, infector) {
	if(g_bomb[infected])
		g_bomb[infected] = false
}

public entity_touch(touched, toucher) {
	if(zp_get_user_zombie(toucher) || zp_get_user_nemesis(toucher)) {
		new Float: pos_ptr[3], Float: pos_ptd[3], Float: push_power = get_pcvar_float(cvar_push)
		
		pev(touched, pev_origin, pos_ptr)
		pev(toucher, pev_origin, pos_ptd)
		
		for(new i = 0; i < 2; i++) {
			pos_ptd[i] -= pos_ptr[i]
			pos_ptd[i] *= push_power
		}
		set_pev(toucher, pev_velocity, pos_ptd)
		set_pev(toucher, pev_impulse, pos_ptd)
	}
}

public remove_ent()
	remove_entity_name(entclas)

public DeleteEntity(entity)
	if(is_valid_ent(entity))
	remove_entity(entity)

stock Color(const id, const input[], any:...) {
	static msg[191]
	vformat(msg, 190, input, 3)
	
	replace_all(msg, 190, "!g", "^4")
	replace_all(msg, 190, "!y", "^1")
	replace_all(msg, 190, "!t", "^3")
	
	message_begin(MSG_ONE_UNRELIABLE, g_SayText, _, id)
	write_byte(id)
	write_string(msg)
	message_end()
}