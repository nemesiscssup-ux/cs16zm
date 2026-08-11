#include <amxmodx>
#include <reapi>

new g_iCvar_RemoveDropped;

public plugin_init() {
	register_plugin("ZP 4.3: Weapon drop strip", "1.0", "Online");
	
	g_iCvar_RemoveDropped = register_cvar("zp_remove_dropped", "30.0");
	
	RegisterHookChain(RG_CWeaponBox_SetModel, "@CWeapon_BoxSetModel_Pre", false);
}

@CWeapon_BoxSetModel_Pre(iEntity, const szModel[]) {
	if (strlen(szModel) < 8)
		return;
	
	if (get_pcvar_float(g_iCvar_RemoveDropped) > 0.0 && FClassnameIs(iEntity, "weaponbox")) {
		set_entvar(iEntity, var_nextthink, get_gametime() + get_pcvar_float(g_iCvar_RemoveDropped));
		return;
	}
}