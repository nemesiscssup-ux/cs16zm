#pragma compress 1

#include <amxmodx>
#include <fun>
#include <fakemeta>
#include <zombieplague>

new g_itemid_ap, g_itemid_hp

const g_ap_amount = 100
const g_ap_limit = 250

public plugin_init() {
	g_itemid_ap = zp_register_extra_item("Броня \r[+100]", 30, ZP_TEAM_HUMAN)
	g_itemid_hp = zp_register_extra_item("ХП \r[+1500]", 30, ZP_TEAM_ZOMBIE)
}

public zp_extra_item_selected(player, itemid) {
	if(itemid == g_itemid_ap)
		set_pev(player, pev_armorvalue, float(min(pev(player, pev_armorvalue) + g_ap_amount, g_ap_limit)))
	else if(itemid == g_itemid_hp)
		set_user_health(player, get_user_health(player) + 1500)
	return PLUGIN_HANDLED
}