#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>
#include <reapi>

#define IsCustomWeapon(%0) (get_entvar(%0, var_impulse) == WEAPON_SPECIAL_CODE)

#define GetItemClip(%0) get_member(%0, m_Weapon_iClip)

#define WEAPON_ANIM_IDLE_TIME 2/16.0
#define WEAPON_ANIM_RELOAD_TIME 136/30.0
#define WEAPON_ANIM_DRAW_TIME 40/30.0
#define WEAPON_ANIM_ATTACK random_num(1, 2)

#define WEAPON_MODEL_VIEW "models/zm_hot_v/v_usas12camo.mdl"
#define WEAPON_MODEL_PLAYER "models/zm_hot_w/p_usas12camo.mdl"

#define WEAPON_WEAPONLIST "zm_hot_w_usas12camo"

const WEAPON_ANIM_IDLE = 0
const WEAPON_ANIM_DRAW = 3
const WEAPON_ANIM_RELOAD_START = 4

const WEAPON_SPECIAL_CODE = 1140
const WEAPON_MAX_CLIP = 18
const WEAPON_DEFAULT_AMMO = 32
const WEAPON_BODY = 0

const Float: WEAPON_RATE = 0.3
const Float: WEAPON_RECOIL = 0.4
const Float: WEAPON_DAMAGE = 1.8

new const WEAPON_REFERENCE[] = { "weapon_xm1014" };
new const WEAPON_NATIVE[] = { "zp_give_user_usas12camo" };

new const WEAPON_MODEL_WORLD[] = { "models/zm_hot_w/w_usas12camo.mdl" };
new const WEAPON_SOUND_FIRE[] = { "weapons/usas_attack-1.wav" };

new HamHook: g_HamHook_TraceAttack[4];

new gl_iszAllocString_ModelView;
new gl_iszAllocString_ModelPlayer;

new gl_iMsgID_Weaponlist,
	gl_iMsgID_Death;

public plugin_init() {
	register_plugin("ZP 4.3: Usas12camo", "1.0", "Online");
	
	RegisterHookChain(RG_CWeaponBox_SetModel, "CWeaponBox__SetModel_Pre", false);
	
	RegisterHam(Ham_Item_Holster, WEAPON_REFERENCE, "CWeapon__Holster_Post", true);
	RegisterHam(Ham_Item_Deploy, WEAPON_REFERENCE, "CWeapon__Deploy_Post", true);
	RegisterHam(Ham_Item_AddToPlayer, WEAPON_REFERENCE, "CWeapon__AddToPlayer_Post", true);
	
	RegisterHam(Ham_Weapon_Reload, WEAPON_REFERENCE, "CWeapon__Reload_Pre", false);
	RegisterHam(Ham_Weapon_WeaponIdle, WEAPON_REFERENCE, "CWeapon__WeaponIdle_Pre", false);
	RegisterHam(Ham_Weapon_PrimaryAttack, WEAPON_REFERENCE,	"CWeapon__PrimaryAttack_Pre", false);
	
	RegisterHam(Ham_Item_PostFrame, WEAPON_REFERENCE, "CWeapon__PostFrame_Pre", false);
	RegisterHam(Ham_Spawn, WEAPON_REFERENCE, "CWeapon__Spawn_Post", true);
	
	g_HamHook_TraceAttack[0] = RegisterHam(Ham_TraceAttack, "func_breakable", "CEntity__TraceAttack_Pre", false);
	g_HamHook_TraceAttack[1] = RegisterHam(Ham_TraceAttack, "info_target", "CEntity__TraceAttack_Pre", false);
	g_HamHook_TraceAttack[2] = RegisterHam(Ham_TraceAttack, "player", "CEntity__TraceAttack_Pre", false);
	g_HamHook_TraceAttack[3] = RegisterHam(Ham_TakeDamage, "player", "CEntity__TakeDamage_Post", true);
	
	gl_iMsgID_Weaponlist = get_user_msgid("WeaponList");
	gl_iMsgID_Death = get_user_msgid("DeathMsg");
}

public plugin_precache() {
	register_clcmd(WEAPON_WEAPONLIST, "Command_HookWeapon");
	
	engfunc(EngFunc_PrecacheModel, WEAPON_MODEL_VIEW);
	engfunc(EngFunc_PrecacheModel, WEAPON_MODEL_PLAYER);
	engfunc(EngFunc_PrecacheModel, WEAPON_MODEL_WORLD);

	engfunc(EngFunc_PrecacheSound, WEAPON_SOUND_FIRE);
	
	UTIL_PrecacheSpritesFromTxt(WEAPON_WEAPONLIST);
	
	gl_iszAllocString_ModelView = engfunc(EngFunc_AllocString, WEAPON_MODEL_VIEW);
	gl_iszAllocString_ModelPlayer = engfunc(EngFunc_AllocString, WEAPON_MODEL_PLAYER);
}

public Command_HookWeapon(id) {
	engclient_cmd(id, WEAPON_REFERENCE);
	return PLUGIN_HANDLED;
}

public Command_GiveWeapon(id) {
	new iItem = rg_give_custom_item(id, WEAPON_REFERENCE, GT_DROP_AND_REPLACE, WEAPON_SPECIAL_CODE);
	
	if (is_nullent(iItem))
		return NULLENT;

	return iItem;
}

public plugin_natives()
	register_native(WEAPON_NATIVE, "Command_GiveWeapon", 1);

public CWeapon__Holster_Post(iItem) {
	if (!IsCustomWeapon(iItem))
		return;
	
	new id = get_member(iItem, m_pPlayer);
	
	set_member(iItem, m_Weapon_flNextPrimaryAttack, 0.0);
	set_member(iItem, m_Weapon_flNextSecondaryAttack, 0.0);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, 0.0);
	set_member(id, m_flNextAttack, 0.0);
}

public CWeapon__Deploy_Post(iItem) {
	if (!IsCustomWeapon(iItem))
		return;
	
	new id = get_member(iItem, m_pPlayer);
	
	set_pev_string(id, pev_viewmodel2, gl_iszAllocString_ModelView);
	set_pev_string(id, pev_weaponmodel2, gl_iszAllocString_ModelPlayer);
	
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_DRAW);
	
	set_member(iItem, m_Weapon_fInReload, 0);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_DRAW_TIME);
	set_member(id, m_flNextAttack, WEAPON_ANIM_DRAW_TIME);
}

public CWeapon__AddToPlayer_Post(iItem, id) {
	new iWeaponKey = get_entvar(iItem, var_impulse);
	
	if (iWeaponKey != 0 && iWeaponKey != WEAPON_SPECIAL_CODE)
		return;
		
	UTIL_WeaponList(id, iItem);
}

public CWeapon__Reload_Pre(iItem) {
	if (!IsCustomWeapon(iItem))
		return HAM_IGNORED;
	
	if (get_member(iItem, m_Weapon_fInReload) != 0)
		return HAM_SUPERCEDE;
	
	new id = get_member(iItem, m_pPlayer);
	
	if (!get_member(id, m_rgAmmo, get_member(iItem, m_Weapon_iPrimaryAmmoType)))
		return HAM_SUPERCEDE;
		
	if (GetItemClip(iItem) >= rg_get_iteminfo(iItem, ItemInfo_iMaxClip))
		return HAM_SUPERCEDE;
	
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_RELOAD_START);
	
	set_member(iItem, m_Weapon_fInReload, 1);
	
	set_member(iItem, m_Weapon_flNextPrimaryAttack, WEAPON_ANIM_RELOAD_TIME);
	set_member(iItem, m_Weapon_flNextSecondaryAttack, WEAPON_ANIM_RELOAD_TIME);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_RELOAD_TIME);
	set_member(id, m_flNextAttack, WEAPON_ANIM_RELOAD_TIME);
	
	return HAM_SUPERCEDE;
}

public CWeapon__WeaponIdle_Pre(iItem) {
	if (!IsCustomWeapon(iItem) || get_member(iItem, m_Weapon_flTimeWeaponIdle) > 0.0)
		return HAM_IGNORED;
	
	static id; id = get_member(iItem, m_pPlayer);
	
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_IDLE);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_IDLE_TIME);
	
	return HAM_SUPERCEDE;
}

public CWeapon__PrimaryAttack_Pre(iItem) {
	if (!IsCustomWeapon(iItem))
		return HAM_IGNORED;
	
	if (!GetItemClip(iItem)) {
		ExecuteHam(Ham_Weapon_PlayEmptySound, iItem);
		set_member(iItem, m_Weapon_flNextPrimaryAttack, 0.2);

		return HAM_SUPERCEDE;
	}
	
	static id; id = get_member(iItem, m_pPlayer);
	
	new FM_TraceLine_Post = register_forward(FM_TraceLine, "FM_Hook_TraceLine_Post", true);
	new FM_PlayBackEvent_Pre = register_forward(FM_PlaybackEvent, "FM_Hook_PlaybackEvent_Pre", false);
	new Msg_EventDeath = register_message(gl_iMsgID_Death, "EV_Hook_DeathMsg");
	
	fm_ham_hook(true);
	
	ExecuteHam(Ham_Weapon_PrimaryAttack, iItem);
	
	unregister_forward(FM_TraceLine, FM_TraceLine_Post, true);
	unregister_forward(FM_PlaybackEvent, FM_PlayBackEvent_Pre);
	unregister_message(gl_iMsgID_Death, Msg_EventDeath);
	
	fm_ham_hook(false);
	
	new Float: vecPunchangle[3]; get_entvar(id, var_punchangle, vecPunchangle);
	
	vecPunchangle[0] *= WEAPON_RECOIL;
	vecPunchangle[1] *= WEAPON_RECOIL;
	vecPunchangle[2] *= WEAPON_RECOIL;
	
	set_entvar(id, var_punchangle, vecPunchangle);
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_ATTACK);
	rh_emit_sound2(id, 0, CHAN_WEAPON, WEAPON_SOUND_FIRE);
	
	if (get_member(iItem, m_Weapon_fInReload) != 0)
		set_member(iItem, m_Weapon_fInReload, 0);
	
	set_member(iItem, m_Weapon_iShellId, get_member(iItem, m_XM1014_iShell));
	set_member(id, m_flEjectBrass, get_gametime());
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_RELOAD_TIME);
	set_member(id, m_flNextAttack, WEAPON_RATE);
	
	return HAM_SUPERCEDE;
}

public EV_Hook_DeathMsg(iMsgID, iMsgDest, id) {
	static iAttacker; iAttacker = get_msg_arg_int(1);
	static iVictim; iVictim = get_msg_arg_int(2);
	
	if (iAttacker == iVictim || !is_user_connected(iAttacker))
		return;
	
	static iItem; iItem = get_member(iAttacker, m_pActiveItem);
	
	if (iItem <= 0 || !IsCustomWeapon(iItem))
		return;
	
	set_msg_arg_string(4, "xm1014");
}

public CWeapon__PostFrame_Pre(iItem) {
	if (!IsCustomWeapon(iItem))
		return HAM_IGNORED;
	
	if (get_member(iItem, m_Weapon_fInReload) == 1) {
		static id; id = get_member(iItem, m_pPlayer);
		
		new iClip = get_member(iItem, m_Weapon_iClip);
		new iAmmoType = get_member(iItem, m_Weapon_iPrimaryAmmoType);
		new iBonusAmmo = get_member(id, m_rgAmmo, iAmmoType);
		
		new iStockAmmo = min(WEAPON_MAX_CLIP - iClip, iBonusAmmo);
		
		set_member(iItem, m_Weapon_fInReload, 0);
		set_member(iItem, m_Weapon_iClip, iClip + iStockAmmo);
		set_member(id, m_rgAmmo, iBonusAmmo - iStockAmmo, iAmmoType);
	}
	
	return HAM_IGNORED;
}

public CWeapon__Spawn_Post(iItem) {
	if (is_nullent(iItem) || !IsCustomWeapon(iItem))
		return;

	set_member(iItem, m_Weapon_iClip, WEAPON_MAX_CLIP);
	set_member(iItem, m_Weapon_iDefaultAmmo, WEAPON_DEFAULT_AMMO);
	
	rg_set_iteminfo(iItem, ItemInfo_iMaxClip, WEAPON_MAX_CLIP);
	rg_set_iteminfo(iItem, ItemInfo_iMaxAmmo1, WEAPON_DEFAULT_AMMO);
	rg_set_iteminfo(iItem, ItemInfo_pszName, WEAPON_WEAPONLIST);
}

public CEntity__TraceAttack_Pre(iVictim, iAttacker, Float: flDamage) {
	if (!is_user_connected(iAttacker))
		return;
	
	static iItem; iItem = get_member(iAttacker, m_pActiveItem);
	
	if (iItem <= 0 || !IsCustomWeapon(iItem))
		return;
	
	SetHamParamFloat(3, flDamage * WEAPON_DAMAGE);
}

public CEntity__TakeDamage_Post(iVictim, iInflictor, iAttacker, Float: flDamage, iDamageType) {
	if (!is_user_connected(iAttacker))
		return;
	
	static iItem; iItem = get_member(iAttacker, m_pActiveItem);
	
	if (iItem <= 0 || !IsCustomWeapon(iItem))
		return;
	
	if (is_user_connected(iVictim))
		set_member(iVictim, m_flVelocityModifier, 0.7);
}

public fm_ham_hook(bool: bEnabled) {
	if (bEnabled) {
		EnableHamForward(g_HamHook_TraceAttack[0]);
		EnableHamForward(g_HamHook_TraceAttack[1]);
		EnableHamForward(g_HamHook_TraceAttack[2]);
		EnableHamForward(g_HamHook_TraceAttack[3]);
	}
	else {
		DisableHamForward(g_HamHook_TraceAttack[0]);
		DisableHamForward(g_HamHook_TraceAttack[1]);
		DisableHamForward(g_HamHook_TraceAttack[2]);
		DisableHamForward(g_HamHook_TraceAttack[3]);
	}
}

public FM_Hook_PlaybackEvent_Pre()
	return FMRES_SUPERCEDE;

public FM_Hook_TraceLine_Post(Float: flOrigin1[3], Float: flOrigin2[3], iFrag, iAttacker, iTrace) {
	if (iFrag & IGNORE_MONSTERS)
		return;
	
	static pHit; pHit = get_tr2(iTrace, TR_pHit);
	
	if (pHit > 0)
		if (get_entvar(pHit, var_solid) != SOLID_BSP)
			return;
	
	static Float: flvecEndPos[3]; get_tr2(iTrace, TR_vecEndPos, flvecEndPos);
	
	engfunc(EngFunc_MessageBegin, MSG_PAS, SVC_TEMPENTITY, flvecEndPos, 0);
	write_byte(TE_GUNSHOTDECAL);
	engfunc(EngFunc_WriteCoord, flvecEndPos[0]);
	engfunc(EngFunc_WriteCoord, flvecEndPos[1]);
	engfunc(EngFunc_WriteCoord, flvecEndPos[2]);
	write_short(pHit > 0 ? pHit : 0);
	write_byte(random_num(41, 45));
	message_end();
}

public CWeaponBox__SetModel_Pre(iEntity) {
	if (is_nullent(iEntity))
		return;
		
	new iItem = UTIL_GetWeaponBoxItem(iEntity);
	
	if (is_nullent(iItem) || !IsCustomWeapon(iItem))
		return;
		
	SetHookChainArg(2, ATYPE_STRING, WEAPON_MODEL_WORLD);
	set_entvar(iEntity, var_body, WEAPON_BODY);
}

stock UTIL_GetWeaponBoxItem(iEntity) {
	new iItem;
	
	for (new iSlot = 0; iSlot < MAX_ITEM_TYPES; iSlot++) {
		iItem = get_member(iEntity, m_WeaponBox_rgpPlayerItems, iSlot);
		
		if (!is_nullent(iItem))
			return iItem;
	}

	return 0;
}

stock UTIL_SendWeaponAnim(id, iAnim) {
	set_entvar(id, var_weaponanim, iAnim);
	
	message_begin(MSG_ONE_UNRELIABLE, SVC_WEAPONANIM, _, id);
	write_byte(iAnim);
	write_byte(0);
	message_end();
}

stock UTIL_PrecacheSpritesFromTxt(szWeaponList[]) {
	new szTxtDir[64], szSprDir[64]; 
	new szFileData[128], szSprName[48], temp[1];
	
	format(szTxtDir, charsmax(szTxtDir), "sprites/%s.txt", szWeaponList);
	engfunc(EngFunc_PrecacheGeneric, szTxtDir);
	
	new iFile = fopen(szTxtDir, "rb");
	
	while (iFile && !feof(iFile)) {
		fgets(iFile, szFileData, charsmax(szFileData));
		trim(szFileData);
		
		if (!strlen(szFileData))
			continue;
		
		new pos = containi(szFileData, "640");	
		
		if (pos == -1)
			continue;
		
		format(szFileData, charsmax(szFileData), "%s", szFileData[pos+3]);		
		trim(szFileData);
		strtok(szFileData, szSprName, charsmax(szSprName), temp, charsmax(temp), ' ', 1);
		trim(szSprName);
		format(szSprDir, charsmax(szSprDir), "sprites/%s.spr", szSprName);
		engfunc(EngFunc_PrecacheGeneric, szSprDir);
	}
	
	if (iFile)
		fclose(iFile);
}

stock UTIL_WeaponList(id, iItem) {
	new szWeaponName[32]; rg_get_iteminfo(iItem, ItemInfo_pszName, szWeaponName, charsmax(szWeaponName));

	message_begin(MSG_ONE_UNRELIABLE, gl_iMsgID_Weaponlist, _, id);
	write_string(szWeaponName);
	write_byte(get_member(iItem, m_Weapon_iPrimaryAmmoType));
	write_byte(rg_get_iteminfo(iItem, ItemInfo_iMaxAmmo1));
	write_byte(get_member(iItem, m_Weapon_iSecondaryAmmoType));
	write_byte(rg_get_iteminfo(iItem, ItemInfo_iMaxAmmo2));
	write_byte(rg_get_iteminfo(iItem, ItemInfo_iSlot));
	write_byte(rg_get_iteminfo(iItem, ItemInfo_iPosition));
	write_byte(rg_get_iteminfo(iItem, ItemInfo_iId));
	write_byte(rg_get_iteminfo(iItem, ItemInfo_iFlags));
	message_end();
}