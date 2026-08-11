#include <amxmodx>
#include <fakemeta>
#include <xs>
#include <hamsandwich>
#include <reapi>

#define IsCustomWeapon(%0) (get_entvar(%0, var_impulse) == WEAPON_SPECIAL_CODE)
#define IsDefaultFOV(%0) (get_member(%0, m_iFOV) == WEAPON_DEFAULT_FOV)

#define GetItemClip(%0) get_member(%0, m_Weapon_iClip)

#define WEAPON_ANIM_IDLE_TIME 51/30.0
#define WEAPON_ANIM_RELOAD_TIME 141/30.0
#define WEAPON_ANIM_DRAW_TIME 31/30.0
#define WEAPON_ANIM_ATTACK random_num(1, 2)

#define WEAPON_MODEL_VIEW "models/zm_hot_v/v_mk48.mdl"
#define WEAPON_MODEL_PLAYER "models/zm_hot_w/p_mk48.mdl"

#define WEAPON_WEAPONLIST "zm_hot_w_mk48"

const WEAPON_ANIM_IDLE = 0
const WEAPON_ANIM_RELOAD_START = 3
const WEAPON_ANIM_DRAW = 4

const WEAPON_SPECIAL_CODE = 1080
const WEAPON_MAX_CLIP = 90
const WEAPON_DEFAULT_AMMO = 200

const WEAPON_CROSSHAIR_FOV = 60
const WEAPON_DEFAULT_FOV = 90

const Float: WEAPON_RATE = 0.1
const Float: WEAPON_SHOT_DISTANCE = 8192.0
const Float: WEAPON_DAMAGE = 50.0
const Float: WEAPON_RANGE_MODIFER = 0.98
const Float: WEAPON_ACCURACY = 0.35

const WEAPON_SHOT_PENETRATION = 2

const Bullet: WEAPON_BULLET_TYPE = BULLET_PLAYER_762MM

new const WEAPON_REFERENCE[] = { "weapon_m249" };
new const WEAPON_NATIVE[] = { "zp_give_user_mk48" };
new const WEAPON_MODEL_WORLD[] = { "models/zm_hot_w/w_mk48.mdl" };

new const WEAPON_SOUND_FIRE[] = { "weapons/mk48_attack-1.wav" };
new const WEAPON_MODEL_SHELL[] = { "models/rshell_big.mdl" };
new const WEAPON_ANIMATION[] = { "m249" };

new Array: gl_aDecals;

new gl_iszAllocString_ModelView;
new gl_iszAllocString_ModelPlayer;
new gl_iszAllocString_ModelShell;

new gl_iMsgID_Weaponlist;

public plugin_init() {
	register_plugin("ZP 4.3: Mk48", "1.0", "Online");
	
	RegisterHookChain(RG_CWeaponBox_SetModel, "CWeaponBox__SetModel_Pre", false);
	
	RegisterHam(Ham_Item_Holster, WEAPON_REFERENCE, "CWeapon__Holster_Post", true);
	RegisterHam(Ham_Item_Deploy, WEAPON_REFERENCE, "CWeapon__Deploy_Post", true);
	RegisterHam(Ham_Item_AddToPlayer, WEAPON_REFERENCE, "CWeapon__AddToPlayer_Post", true);
	
	RegisterHam(Ham_Weapon_Reload, WEAPON_REFERENCE, "CWeapon__Reload_Post", true);
	RegisterHam(Ham_Weapon_WeaponIdle, WEAPON_REFERENCE, "CWeapon__WeaponIdle_Pre", false);
	RegisterHam(Ham_Weapon_PrimaryAttack, WEAPON_REFERENCE,	"CWeapon__PrimaryAttack_Pre", false);
	RegisterHam(Ham_Weapon_SecondaryAttack, WEAPON_REFERENCE, "CWeapon__SecondaryAttack_Pre", false);
	
	RegisterHam(Ham_Spawn, WEAPON_REFERENCE, "CWeapon__Spawn_Post", true);
	
	gl_iMsgID_Weaponlist = get_user_msgid("WeaponList");
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
	gl_iszAllocString_ModelShell = engfunc(EngFunc_PrecacheModel, WEAPON_MODEL_SHELL);
	
	gl_aDecals = ArrayCreate(1, 1);
	
	register_forward(FM_DecalIndex, "FM_Hook_DecalIndex_Post", true);
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
	
	UTIL_SetUserFOV(id, WEAPON_DEFAULT_FOV);
}

public CWeapon__Deploy_Post(iItem) {
	if (!IsCustomWeapon(iItem))
		return;
	
	new id = get_member(iItem, m_pPlayer);
	
	set_pev_string(id, pev_viewmodel2, gl_iszAllocString_ModelView);
	set_pev_string(id, pev_weaponmodel2, gl_iszAllocString_ModelPlayer);
	
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_DRAW);
	
	set_member(iItem, m_Weapon_flAccuracy, WEAPON_ACCURACY);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_DRAW_TIME);
	set_member(id, m_szAnimExtention, WEAPON_ANIMATION);
	set_member(id, m_flNextAttack, WEAPON_ANIM_DRAW_TIME);
}

public CWeapon__AddToPlayer_Post(iItem, id) {
	new iWeaponKey = get_entvar(iItem, var_impulse);
	
	if (iWeaponKey != 0 && iWeaponKey != WEAPON_SPECIAL_CODE)
		return;
		
	UTIL_WeaponList(id, iItem);
}

public CWeapon__Reload_Post(iItem) {
	if (!IsCustomWeapon(iItem))
		return;
	
	new id = get_member(iItem, m_pPlayer);
	
	if (!get_member(id, m_rgAmmo, get_member(iItem, m_Weapon_iPrimaryAmmoType)))
		return;
		
	if (GetItemClip(iItem) >= rg_get_iteminfo(iItem, ItemInfo_iMaxClip))
		return;
	
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_RELOAD_START);
	
	set_member(iItem, m_Weapon_flNextPrimaryAttack, WEAPON_ANIM_RELOAD_TIME);
	set_member(iItem, m_Weapon_flNextSecondaryAttack, WEAPON_ANIM_RELOAD_TIME);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_RELOAD_TIME);
	set_member(id, m_flNextAttack, WEAPON_ANIM_RELOAD_TIME);
	
	UTIL_SetUserFOV(id, WEAPON_DEFAULT_FOV);
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
	
	new Float: vecVelocity[3]; get_entvar(id, var_velocity, vecVelocity);
	new Float: vecOrigin[3]; get_entvar(id, var_origin, vecOrigin);
	new Float: vecViewOfs[3]; get_entvar(id, var_view_ofs, vecViewOfs);
	new Float: vecSrc[3]; xs_vec_add(vecOrigin, vecViewOfs, vecSrc);
	new Float: vecAiming[3]; UTIL_GetVectorAiming(id, vecAiming);
	
	new Float: flSpread;
	new Float: flAccuracy = get_member(iItem, m_Weapon_flAccuracy);
	new iShotsFired = get_member(iItem, m_Weapon_iShotsFired);
	new bitsFlags = get_entvar(id, var_flags);
	new iClip = GetItemClip(iItem);
	
	iShotsFired += 1;
	iClip -= 1;
	
	if (~bitsFlags & FL_ONGROUND)
		flSpread = 0.2 * flAccuracy;
	else
		flSpread = 0.08 * flAccuracy;
		
	if (flAccuracy != 0.0) {
		flAccuracy = ((iShotsFired * iShotsFired) / 220.0) + 0.35;
		
		if (flAccuracy > 1.0)
			flAccuracy = 1.0;
	}
	
	new FM_TraceLine_Post = register_forward(FM_TraceLine, "FM_Hook_TraceLine_Post", true);
	
	rg_fire_bullets3(iItem, id, vecSrc, vecAiming, flSpread, WEAPON_SHOT_DISTANCE, WEAPON_SHOT_PENETRATION, WEAPON_BULLET_TYPE, floatround(WEAPON_DAMAGE), WEAPON_RANGE_MODIFER, false, get_member(id, random_seed));
	unregister_forward(FM_TraceLine, FM_TraceLine_Post, true);
	
	UTIL_SendWeaponAnim(id, WEAPON_ANIM_ATTACK);
	UTIL_SendPlayerAnim(id, WEAPON_ANIMATION);
	
	rh_emit_sound2(id, 0, CHAN_WEAPON, WEAPON_SOUND_FIRE);

	UTIL_WeaponKickBack(iItem, id, 0.8, 0.10, 0.5, 0.5, 1.5, 1.5, 2);

	set_member(iItem, m_Weapon_iShellId, gl_iszAllocString_ModelShell);
	set_member(id, m_flEjectBrass, get_gametime());
	
	set_member(iItem, m_Weapon_iClip, iClip);
	set_member(iItem, m_Weapon_flAccuracy, flAccuracy);
	set_member(iItem, m_Weapon_iShotsFired, iShotsFired);
	set_member(iItem, m_Weapon_flNextPrimaryAttack, WEAPON_RATE);
	set_member(iItem, m_Weapon_flNextSecondaryAttack, WEAPON_RATE);
	set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_DRAW_TIME);
	
	return HAM_SUPERCEDE;
}

public CWeapon__SecondaryAttack_Pre(iItem) {
	if (!IsCustomWeapon(iItem))
		return HAM_IGNORED;
		
	if (get_member(iItem, m_Weapon_flNextPrimaryAttack) <= 0.0) {
		static id; id = get_member(iItem, m_pPlayer);
		
		UTIL_SetUserFOV(id, IsDefaultFOV(id) ? WEAPON_CROSSHAIR_FOV : WEAPON_DEFAULT_FOV);
		
		set_member(iItem, m_Weapon_flNextPrimaryAttack, 0.3);
		set_member(iItem, m_Weapon_flNextSecondaryAttack, 0.3);
		set_member(iItem, m_Weapon_flTimeWeaponIdle, WEAPON_ANIM_DRAW_TIME);
		set_member(id, m_flNextAttack, 0.3);
		
		rh_emit_sound2(id, 0, CHAN_ITEM, "weapons/zoom.wav", VOL_NORM, ATTN_NORM);
	}
	
	return HAM_SUPERCEDE;
}

public CWeapon__Spawn_Post(iItem) {
	if (is_nullent(iItem) || !IsCustomWeapon(iItem))
		return;

	set_member(iItem, m_Weapon_iClip, WEAPON_MAX_CLIP);
	set_member(iItem, m_Weapon_iDefaultAmmo, WEAPON_DEFAULT_AMMO);
	set_member(iItem, m_Weapon_bHasSecondaryAttack, true);
	
	rg_set_iteminfo(iItem, ItemInfo_iMaxClip, WEAPON_MAX_CLIP);
	rg_set_iteminfo(iItem, ItemInfo_iMaxAmmo1, WEAPON_DEFAULT_AMMO);
	rg_set_iteminfo(iItem, ItemInfo_pszName, WEAPON_WEAPONLIST);
}

public FM_Hook_DecalIndex_Post()
	ArrayPushCell(gl_aDecals, get_orig_retval());

public FM_Hook_TraceLine_Post(Float: vecSrc[3], Float: vecEnd[3], iBitsFlags, iEntToSkip, iTrace) {
	if (iBitsFlags & IGNORE_MONSTERS)
		return;

	new Float: flFraction; get_tr2(iTrace, TR_flFraction, flFraction);
	
	if (flFraction == 1.0)
		return;

	UTIL_GunshotDecalTrace(0);
	UTIL_GunshotDecalTrace(iTrace, true);
}

public CWeaponBox__SetModel_Pre(iEntity) {
	if (is_nullent(iEntity))
		return;
		
	new iItem = UTIL_GetWeaponBoxItem(iEntity);
	
	if (is_nullent(iItem) || !IsCustomWeapon(iItem))
		return;
		
	SetHookChainArg(2, ATYPE_STRING, WEAPON_MODEL_WORLD);
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

stock UTIL_GunshotDecalTrace(iTrace, bool: bIsGunshot = false) {
	new Float: vecEndPos[3]; get_tr2(iTrace, TR_vecEndPos, vecEndPos);
	new iPointContents = engfunc(EngFunc_PointContents, vecEndPos);
	
	if (iPointContents == CONTENTS_SKY)
		return;

	new pHit = (pHit = get_tr2(iTrace, TR_pHit)) == -1 ? 0 : pHit;
	
	if (pHit && is_nullent(pHit) || (get_entvar(pHit, var_flags) & FL_KILLME))
		return;
	
	if (get_entvar(pHit, var_solid) != SOLID_BSP && get_entvar(pHit, var_movetype) != MOVETYPE_PUSHSTEP)
		return;

	new iDecalIndex = ExecuteHamB(Ham_DamageDecal, pHit, 0);
	
	if (iDecalIndex < 0 || iDecalIndex >= ArraySize(gl_aDecals))
		return;
	
	iDecalIndex = ArrayGetCell(gl_aDecals, iDecalIndex);
	
	if (iDecalIndex < 0)
		return;
	
	new iMessage;
	
	if (bIsGunshot)
		iMessage = TE_GUNSHOTDECAL;
	else {
		iMessage = TE_DECAL;
		
		if (pHit != 0) {
			if (iDecalIndex > 255) {
				iMessage = TE_DECALHIGH;
				iDecalIndex -= 256;
			}
		}
		else {
			iMessage = TE_WORLDDECAL;
			
			if (iDecalIndex > 255) {
				iMessage = TE_WORLDDECALHIGH;
				iDecalIndex -= 256;
			}
		}
	}

	message_begin_f(MSG_PAS, SVC_TEMPENTITY, vecEndPos);
	write_byte(iMessage);
	write_coord_f(vecEndPos[0]);
	write_coord_f(vecEndPos[1]);
	write_coord_f(vecEndPos[2]);
	
	if (bIsGunshot) {
		write_short(pHit);
		write_byte(iDecalIndex);
	}
	else {
		write_byte(iDecalIndex);
		
		if (pHit)
			write_short(pHit);
	}

	message_end();

	if (bIsGunshot && iPointContents != CONTENTS_WATER) {
		new Float: vecPlaneNormal[3]; get_tr2(iTrace, TR_vecPlaneNormal, vecPlaneNormal);

		message_begin_f(MSG_PVS, SVC_TEMPENTITY, vecEndPos);
		write_byte(TE_STREAK_SPLASH);
		write_coord_f(vecEndPos[0]);
		write_coord_f(vecEndPos[1]);
		write_coord_f(vecEndPos[2]);
		write_coord_f(vecPlaneNormal[0] * random_float(25.0, 30.0));
		write_coord_f(vecPlaneNormal[1] * random_float(25.0, 30.0));
		write_coord_f(vecPlaneNormal[2] * random_float(25.0, 30.0));
		write_byte(4);
		write_short(22);
		write_short(3);
		write_short(65);
		message_end();
	}
}

stock UTIL_SendWeaponAnim(id, iAnim) {
	set_entvar(id, var_weaponanim, iAnim);
	
	message_begin(MSG_ONE_UNRELIABLE, SVC_WEAPONANIM, _, id);
	write_byte(iAnim);
	write_byte(0);
	message_end();
}

stock UTIL_SendPlayerAnim(id, const szAnim[]) {
	static szAnimation[64]; formatex(szAnimation, charsmax(szAnimation), get_entvar(id, var_flags) & FL_DUCKING ? "crouch_shoot_%s" : "ref_shoot_%s", szAnim);
	UTIL_PlayerAnimation(id, szAnimation);
}

stock UTIL_PlayerAnimation(id, szAnim[]) {
	new iAnimDesired, Float: flFrameRate, Float: flGroundSpeed, bool: bLoops;
	
	if ((iAnimDesired = lookup_sequence(id, szAnim, flFrameRate, bLoops, flGroundSpeed)) == -1)
		iAnimDesired = 0;

	set_entvar(id, var_frame, 0.0);
	set_entvar(id, var_framerate, 1.0);
	set_entvar(id, var_animtime, get_gametime());
	set_entvar(id, var_sequence, iAnimDesired);
	
	set_member(id, m_fSequenceLoops, bLoops);
	set_member(id, m_fSequenceFinished, 0);
	set_member(id, m_flFrameRate, flFrameRate);
	set_member(id, m_flGroundSpeed, flGroundSpeed);
	set_member(id, m_flLastEventCheck, get_gametime());
	set_member(id, m_Activity, ACT_RANGE_ATTACK1);
	set_member(id, m_IdealActivity, ACT_RANGE_ATTACK1);
	set_member(id, m_flLastFired, get_gametime());
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

stock UTIL_GetVectorAiming(id, Float: vecAiming[3]) {
	new Float: vecPunchangle[3]; get_entvar(id, var_punchangle, vecPunchangle);
	new Float: vecViewAngle[3]; get_entvar(id, var_v_angle, vecViewAngle);
	
	xs_vec_add(vecViewAngle, vecPunchangle, vecViewAngle);
	angle_vector(vecViewAngle, ANGLEVECTOR_FORWARD, vecAiming);
}

stock UTIL_WeaponKickBack(iItem, id, Float: flUpBase, Float: flLateralBase, Float: flUpModifier, Float: flLateralModifier, Float: flUpMax, Float: flLateralMax, iDirectionChange) {
	new Float: flKickUp;
	new Float: flKickLateral;
	new iShotsFired = get_member(iItem, m_Weapon_iShotsFired);
	new iDirection = get_member(iItem, m_Weapon_iDirection);
	new Float: vecPunchangle[3]; get_entvar(id, var_punchangle, vecPunchangle);

	if (iShotsFired == 1) {
		flKickUp = flUpBase;
		flKickLateral = flLateralBase;
	}
	else {
		flKickUp = iShotsFired * flUpModifier + flUpBase;
		flKickLateral = iShotsFired * flLateralModifier + flLateralBase;
	}

	vecPunchangle[0] -= flKickUp;

	if (vecPunchangle[0] < -flUpMax)
		vecPunchangle[0] = -flUpMax;

	if (iDirection) {
		vecPunchangle[1] += flKickLateral;
		
		if (vecPunchangle[1] > flLateralMax)
			vecPunchangle[1] = flLateralMax;
	}
	else {
		vecPunchangle[1] -= flKickLateral;
		
		if (vecPunchangle[1] < -flLateralMax)
			vecPunchangle[1] = -flLateralMax;
	}

	if (!random_num(0, iDirectionChange))
		set_member(iItem, m_Weapon_iDirection, iDirection);

	set_entvar(id, var_punchangle, vecPunchangle);
}

stock UTIL_SetUserFOV(id, iFOV = WEAPON_DEFAULT_FOV) {
	static iMsgID_SetFOV;
	
	if (!iMsgID_SetFOV)
		iMsgID_SetFOV = get_user_msgid("SetFOV");

	message_begin(MSG_ONE_UNRELIABLE, iMsgID_SetFOV, _, id);
	write_byte(iFOV);
	message_end();

	set_entvar(id, var_fov, iFOV);
	set_member(id, m_iFOV, iFOV);
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