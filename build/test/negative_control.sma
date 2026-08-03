/* ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ АУДИТА.
 *
 * Обычный безобидный игровой плагин того же класса, что и содержимое зомби-сборок:
 * меню, сообщения, cvar-настройки, награда за убийство. Ничего запретного.
 *
 * Нужен для измерения ложных срабатываний: если сканер красит и его — правила
 * слишком грубые и вердикты по настоящим сборкам ничего не стоят.
 */
#include <amxmodx>
#include <amxmisc>

new g_pCvarBonus

public plugin_init() {
	register_plugin("ZP Kill Bonus", "1.0", "audit-test")
	g_pCvarBonus = register_cvar("zp_kill_bonus", "2")
	register_clcmd("say /bonus", "cmd_bonus")
	register_event("DeathMsg", "event_death", "a")
}

public cmd_bonus(id) {
	new menu = menu_create("Bonus", "menu_handler")
	menu_additem(menu, "Show my bonus", "1", 0)
	menu_display(id, menu, 0)
	return PLUGIN_HANDLED
}

public menu_handler(id, menu, item) {
	if (item == MENU_EXIT) {
		menu_destroy(menu)
		return PLUGIN_HANDLED
	}
	client_print(id, print_chat, "[ZP] Bonus per kill: %d", get_pcvar_num(g_pCvarBonus))
	menu_destroy(menu)
	return PLUGIN_HANDLED
}

public event_death() {
	new killer = read_data(1)
	if (!is_user_connected(killer)) return
	new name[32]
	get_user_name(killer, name, charsmax(name))
	client_print(0, print_chat, "[ZP] %s got %d ammo packs", name, get_pcvar_num(g_pCvarBonus))
}
