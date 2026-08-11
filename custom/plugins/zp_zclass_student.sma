#pragma compress 1

#include <amxmodx>
#include <zombieplague>

#define PLUGIN_NAME "zp_zclass_student"
#define PLUGIN_VERSION "1.0"
#define PLUGIN_AUTHOR "MKOD | Сергей Одинокий | https://vk.com/mkod1"

new const ZCLASS_NAME[] = "Студентка"
new const ZCLASS_INFO[] = "\rСкачок (E)"
new const ZCLASS_PLAYER_MDL[] = "zm_hot_z_student"
new const ZCLASS_CLAW_MDL[] = "v_claw_student.mdl"
const ZCLASS_HP = 1900
const ZCLASS_SPEED = 240
const Float: ZCLASS_GRAVITY = 0.65
const Float: ZCLASS_KNOCKBACK = 1.0

public plugin_init()
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR)

public plugin_precache()
	zp_register_zombie_class(ZCLASS_NAME, ZCLASS_INFO, ZCLASS_PLAYER_MDL, ZCLASS_CLAW_MDL, ZCLASS_HP, ZCLASS_SPEED, ZCLASS_GRAVITY, ZCLASS_KNOCKBACK)