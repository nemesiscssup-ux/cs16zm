/*
 * [ZP] Гранаты зомби: отброс даром, заражение за кредиты.
 *
 * Обычная граната зомби НЕ заражает — она расшвыривает людей в стороны. Нужна
 * против засевших в углу: сдвинуть их с места, а не убить.
 *
 * ⚠️ ГЛАВНАЯ ЛОВУШКА. Мод сам превращает ЛЮБУЮ гранату зомби в «бомбу
 * заражения»: в fw_SetModel он ставит на сущность метку NADE_TYPE_INFECTION,
 * и на взрыве заражает всех рядом. Поэтому выданная нами граната приходила к
 * игроку заражающей, хотя задумывалась как толчок. Метку снимаем сразу после
 * броска — своим форвардом FM_SetModel, зарегистрированным ПОСЛЕ модовского.
 *
 * Заражение осталось, но стало товаром: «Граната заражения» в спец-магазине.
 * Купивший получает один заряд, и ближайшая его граната метку СОХРАНЯЕТ —
 * заражает уже сам мод, своим же кодом.
 *
 * СКОЛЬКО ГРАНАТ. Одна — в момент заражения, даром. Дальше только за кредиты:
 * бесконечная выдача по таймеру превращала зомби в метателя, который швыряется
 * не переставая и толкает людей с любого расстояния. Владелец попросил оставить
 * первую в подарок, а повторные вынести в спец-магазин.
 *
 * На спец-раундах (Немезида, Выживший, Снайпер, Чума, Армагеддон, Рой) зомби
 * не покупает ничего: событие раунда не должно ломаться покупками.
 */

#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>
#include <fun>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Гранаты зомби"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_GIVE 4200

// Те же значения, что у мода: поле метки и её вид. Свои константы, а не
// подключение чужого файла, — мод их наружу не отдаёт.
const PEV_NADE_TYPE = pev_flTimeStepSound
const NADE_TYPE_INFECTION = 1111
const NADE_TYPE_NAPALM = 2222
const NADE_TYPE_FROST = 3333
const NADE_TYPE_FLARE = 4444

new cvar_enabled, cvar_force, cvar_radius, cvar_selfpush, cvar_log
new cvar_infcost, cvar_pushcost
new g_sprite_blast

// Оплаченный заряд заражения: ближайшая брошенная граната сохранит метку мода.
new bool:g_inf_charge[33]
new g_item_infnade, g_item_pushnade
new bool:g_has_push, bool:g_has_infect

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled  = register_cvar("zp_znade_enabled", "1")
    cvar_force    = register_cvar("zp_znade_force", "900")     // сила отброса
    cvar_radius   = register_cvar("zp_znade_radius", "300")    // радиус действия
    cvar_selfpush = register_cvar("zp_znade_selfpush", "1")    // подбрасывает ли самого зомби
    // Общий выключатель журнала действий, один на все наши плагины. Проверить
    // работу гранаты иначе нельзя — движок броски и взрывы никуда не пишет.
    cvar_log = register_cvar("zp_log_actions", "1")
    cvar_infcost  = register_cvar("zp_znade_infect_cost", "40")  // цена гранаты заражения
    cvar_pushcost = register_cvar("zp_znade_push_cost", "12")    // цена повторной гранаты отброса

    RegisterHam(Ham_Think, "grenade", "fw_GrenadeThink")

    // 4 = CSW_HEGRENADE: только в руках с гранатой нам есть что менять.
    register_event("CurWeapon", "event_curweapon", "be", "1=1", "2=4")

    // ⚠️ ОДНОГО CurWeapon МАЛО. Мод ставит свой вид гранаты не по событию, а в
    // Ham_Item_Deploy — то есть РАНЬШЕ, чем придёт CurWeapon. Между этими
    // двумя мгновениями зомби держит штатную «бомбу заражения» мода, а у неё
    // руки ЧЕЛОВЕЧЕСКИЕ: лапа класса на долю секунды подменяется людскими
    // ладонями. Именно это владелец видел как «руки меняются сами, особенно
    // после гранаты» — поймано измерителем: оружие ещё нож, а вид уже
    // v_grenade_infect.mdl.
    //
    // Цепляемся туда же и ПОСЛЕ мода (наш плагин грузится ниже), поэтому
    // последнее слово о виде гранаты остаётся за нами.
    RegisterHam(Ham_Item_Deploy, "weapon_hegrenade", "fw_nade_deploy_post", 1)

    // ПОСЛЕ мода: он ставит метку заражения в своём обработчике того же
    // форварда, а мы её снимаем. Регистрация идёт по порядку загрузки
    // плагинов, и наш загружается ниже — значит и вызовут нас позже.
    register_forward(FM_SetModel, "fw_SetModel_Post", 1)

    // Здесь же, как и в остальных наших плагинах магазина: мод грузится выше,
    // его натив к этому моменту уже зарегистрирован. Сначала дешёвый отброс,
    // потом заражение: в меню товары идут в порядке регистрации.
    g_item_pushnade = zp_register_extra_item("Граната отброса",
        get_pcvar_num(cvar_pushcost), ZP_TEAM_ZOMBIE)
    g_item_infnade = zp_register_extra_item("Граната заражения",
        get_pcvar_num(cvar_infcost), ZP_TEAM_ZOMBIE)
}

// Мод показывает ЛЮБУЮ гранату зомби как заражающую (см. выше), поэтому
// граната отброса выглядела ровно как бомба заражения. Свой вид ставим сами.
//
// В моделях уже есть РУКИ ЗОМБИ: игрок держит не абстрактную гранату, а
// оторванную голову, и видно, чем он её держит.
new const MODEL_PUSH[] = "models/zm_hot/v_zbomb2.mdl"
new const MODEL_INFECT[] = "models/zm_hot/v_zbomb_virus.mdl"
// Что видят остальные, пока граната В РУКАХ: брошенная голова, а не штатная
// граната.
new const MODEL_WORLD[] = "models/zm_hot/q_zbomb_new2.mdl"
new bool:g_has_world

// ── у каждой гранаты свой вид в полёте ──────────────────────────────────────────
//
// ⚠️ ЗАЧЕМ. Владелец: «когда кидаешь, трейлы и модель у гранат одинаковые».
// Так и было: игровой модуль выдаёт ВСЕМ брошенным гранатам штатную
// w_hegrenade, а мод только подкрашивает след — и в полёте заражение не
// отличить от отброса. Решение «бежать или ловить» человек принимает как раз по
// летящему предмету, поэтому вид разводим по видам гранат.
//
// Порядок в таблице — как в NADES ниже: метка мода, модель, спрайт следа, цвет
// следа и цвет свечения. Ноль в метке — наша граната отброса: мод свою метку с
// неё уже снял (см. fw_SetModel_Post ниже), других гранат без метки не бывает.
enum _:NADE { NTYPE, NMODEL[40], NR, NG, NB, NWIDTH, NLIFE }
new const NADES[][NADE] = {
    // отброс — белый широкий след, его видно и в дыму
    { 0,                  "models/zm_hot/w_zm_hot_push.mdl",   220, 220, 255, 14, 8 },
    { NADE_TYPE_INFECTION, "models/zm_hot/w_zm_hot_infect.mdl",  0, 220,  40, 10, 10 },
    { NADE_TYPE_NAPALM,   "models/zm_hot/w_zm_hot_fire.mdl",   255, 110,   0, 12, 10 },
    { NADE_TYPE_FROST,    "models/zm_hot/w_zm_hot_frost.mdl",   80, 180, 255, 10, 10 },
    { NADE_TYPE_FLARE,    "models/zm_hot/w_zm_hot_flare.mdl",  255, 230, 120, 12, 12 },
}
new bool:g_nade_ready[sizeof NADES]
new g_trail_spr

// ⚠️ Ставим модель ИЗ обработчика установки модели — без сторожа он позовёт сам
// себя и уйдёт в бесконечную петлю.
new bool:g_setting_model = false

// Низкий глухой удар вместо взрыва. Файл штатный, качать нечего.
new const SND_BLAST[] = "weapons/explode3.wav"

public plugin_precache()
{
    g_sprite_blast = precache_model("sprites/shockwave.spr")
    precache_sound(SND_BLAST)

    // Нет файла — просто останется вид от мода. Ронять сервер из-за косметики
    // нельзя, а precache_model на отсутствующий файл делает именно это.
    // Наличие запоминаем: CurWeapon приходит часто, лазить на диск каждый раз
    // незачем.
    g_has_push = file_exists(MODEL_PUSH)
    g_has_infect = file_exists(MODEL_INFECT)
    g_has_world = bool:file_exists(MODEL_WORLD)
    if (g_has_world) precache_model(MODEL_WORLD)
    if (g_has_push) precache_model(MODEL_PUSH)
    if (g_has_infect) precache_model(MODEL_INFECT)

    // След берём тот же, которым мод рисует свои: файл штатный, качать нечего,
    // а цвет и толщину задаём каждой гранате свои.
    g_trail_spr = precache_model("sprites/laserbeam.spr")

    for (new i = 0; i < sizeof NADES; i++)
    {
        g_nade_ready[i] = bool:file_exists(NADES[i][NMODEL])
        if (g_nade_ready[i]) precache_model(NADES[i][NMODEL])
        else log_amx("нет модели гранаты: %s", NADES[i][NMODEL])
    }
}

// Мод ставит вид гранаты в своём обработчике CurWeapon. Наш плагин грузится
// ниже, значит наш обработчик отработает после — и последнее слово за нами.
public event_curweapon(id)
{
    show_nade(id)
}

// Тот же вид, но в момент доставания гранаты — до первого CurWeapon.
// Хозяин оружия лежит в pev_owner: так его берут и перенесённые стволы, и это
// надёжнее смещений в приватных данных, которые у Windows и Linux разные.
public fw_nade_deploy_post(ent)
{
    if (!pev_valid(ent)) return;
    new id = pev(ent, pev_owner)
    if (id >= 1 && id <= 32) show_nade(id)
}

show_nade(id)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return;
    if (!zp_get_user_zombie(id)) return;

    if (g_inf_charge[id])
    {
        if (g_has_infect) set_pev(id, pev_viewmodel2, MODEL_INFECT)
    }
    else if (g_has_push) set_pev(id, pev_viewmodel2, MODEL_PUSH)

    // Модель в руках у ОСТАЛЬНЫХ — та же голова.
    if (g_has_world) set_pev(id, pev_weaponmodel2, MODEL_WORLD)
}

// ── заражение как товар ─────────────────────────────────────────────────────────

// Особый раунд — любой, кроме обычного заражения и «множественного». На таких
// раунд ведёт событие: Немезида, Выживший, Снайпер, Убийца, Чума, Рой,
// Армагеддон, Апокалипсис, Кошмар. Покупки их ломают.
bool:special_round()
{
    return zp_is_nemesis_round() || zp_is_assassin_round() || zp_is_survivor_round()
        || zp_is_sniper_round() || zp_is_swarm_round() || zp_is_plague_round()
        || zp_is_armageddon_round() || zp_is_apocalypse_round() || zp_is_nightmare_round();
}

public zp_extra_item_selected(id, itemid)
{
    // Магазин зомби на особом раунде закрыт целиком: мод вернёт кредиты сам,
    // как только мы ответим ZP_PLUGIN_HANDLED.
    if (zp_get_user_zombie(id) && special_round())
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 На особом раунде магазин зомби закрыт.")
        return ZP_PLUGIN_HANDLED;
    }

    if (itemid != g_item_pushnade && itemid != g_item_infnade) return PLUGIN_CONTINUE;

    if (!is_user_alive(id) || !zp_get_user_zombie(id))
        return ZP_PLUGIN_HANDLED;

    // Вторую гранату мод в руки не даёт. Заряд заражения при этом купить можно
    // и с гранатой в руках — он вешается на ближайший бросок, а не на предмет.
    if (itemid == g_item_pushnade)
    {
        if (user_has_weapon(id, CSW_HEGRENADE))
        {
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Граната уже в руках — вторую держать некуда.")
            return ZP_PLUGIN_HANDLED;
        }

        give_hegrenade(id)
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Куплена ^x04граната отброса^x01 — расшвыривает людей, но не убивает.")

        new buyer[32]
        get_user_name(id, buyer, charsmax(buyer))
        zlog("ГРАНАТА: %s купил отброс за %d", buyer, get_pcvar_num(cvar_pushcost))
        return PLUGIN_CONTINUE;
    }

    g_inf_charge[id] = true
    give_hegrenade(id)

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Куплена ^x04граната заражения^x01 — заражает всех рядом на взрыве. Заряд один.")

    new name[32]
    get_user_name(id, name, charsmax(name))
    zlog("ГРАНАТА: %s купил заражение за %d", name, get_pcvar_num(cvar_infcost))
    return PLUGIN_CONTINUE;
}

// Метку заражения мод ставит на КАЖДУЮ гранату зомби. Снимаем её у всех, кроме
// оплаченной: иначе обычная граната отброса приходила бы заражающей.
public fw_SetModel_Post(ent, const model[])
{
    if (!get_pcvar_num(cvar_enabled) || !pev_valid(ent)) return FMRES_IGNORED;
    if (g_setting_model) return FMRES_IGNORED;

    // Только брошенные гранаты: у лежащих в коробке оружия времени подрыва нет.
    static Float:dmgtime
    pev(ent, pev_dmgtime, dmgtime)
    if (dmgtime <= 0.0) return FMRES_IGNORED;

    // Своя модель есть только у гранат — по имени штатной и отличаем.
    if (!equal(model, "models/w_", 9)) return FMRES_IGNORED;

    new type = pev(ent, PEV_NADE_TYPE)

    // Метку заражения мод ставит на КАЖДУЮ гранату зомби. Снимаем её у всех,
    // кроме оплаченной: иначе обычная граната отброса приходила бы заражающей.
    if (type == NADE_TYPE_INFECTION)
    {
        new owner = pev(ent, pev_owner)
        if (!is_user_connected(owner)) return FMRES_IGNORED;

        if (g_inf_charge[owner]) g_inf_charge[owner] = false   // заряд израсходован
        else
        {
            set_pev(ent, PEV_NADE_TYPE, 0)
            type = 0
        }
    }

    dress_nade(ent, type)
    return FMRES_IGNORED;
}

// Вид летящей гранаты: своя модель, свой след, своё свечение.
dress_nade(ent, type)
{
    new n = -1
    for (new i = 0; i < sizeof NADES; i++)
        if (NADES[i][NTYPE] == type) { n = i; break; }

    // Ноль — это наша граната отброса, но так же выглядит и любая ЧЕЛОВЕЧЕСКАЯ
    // граната без особых свойств. Её трогать нельзя: пусть остаётся штатной.
    if (n < 0) return;
    if (n == 0 && !zp_get_user_zombie(pev(ent, pev_owner))) return;
    if (!g_nade_ready[n]) return;

    g_setting_model = true
    engfunc(EngFunc_SetModel, ent, NADES[n][NMODEL])
    g_setting_model = false

    // Свечение задаём полями напрямую: engine-модуль тут не подключён, а
    // тащить его ради одной строки незачем.
    static Float:glow[3]
    glow[0] = float(NADES[n][NR])
    glow[1] = float(NADES[n][NG])
    glow[2] = float(NADES[n][NB])
    set_pev(ent, pev_renderfx, kRenderFxGlowShell)
    set_pev(ent, pev_rendercolor, glow)
    set_pev(ent, pev_rendermode, kRenderNormal)
    set_pev(ent, pev_renderamt, 12.0)

    // ⚠️ След цепляется к СУЩНОСТИ и живёт, пока она жива. Мод посылает свой
    // такой же для заражения, напалма и мороза — наш ляжет поверх и будет
    // толще; у отброса своего следа не было вовсе, и в полёте его не замечали.
    message_begin(MSG_BROADCAST, SVC_TEMPENTITY)
    write_byte(TE_BEAMFOLLOW)
    write_short(ent)
    write_short(g_trail_spr)
    write_byte(NADES[n][NLIFE])
    write_byte(NADES[n][NWIDTH])
    write_byte(NADES[n][NR])
    write_byte(NADES[n][NG])
    write_byte(NADES[n][NB])
    write_byte(220)
    message_end()
}

public zp_user_infected_post(id, infector)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return;

    // С задержкой: ZP в момент заражения как раз снимает с игрока оружие,
    // и выданная сию секунду граната исчезла бы вместе с остальным.
    remove_task(id + TASK_GIVE)
    set_task(1.0, "give_nade", id + TASK_GIVE)
}

// Граната в руках уже есть — второй мод не даст, и покупка пропала бы даром.
give_hegrenade(id)
{
    if (!user_has_weapon(id, CSW_HEGRENADE)) give_item(id, "weapon_hegrenade")
}

public zp_user_humanized_post(id)
{
    remove_task(id + TASK_GIVE)
    g_inf_charge[id] = false    // человеку заражать нечем
}

public client_putinserver(id) g_inf_charge[id] = false
// Четыре параметра обязательны: форвард с одним не вызывается вовсе.
public client_disconnected(id, bool:drop, message[], maxlen)
{
    remove_task(id + TASK_GIVE)
    g_inf_charge[id] = false
}

public give_nade(taskid)
{
    new id = taskid - TASK_GIVE
    if (!is_user_alive(id) || !zp_get_user_zombie(id)) return;

    if (!user_has_weapon(id, CSW_HEGRENADE))
    {
        give_hegrenade(id)
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Получена ^x04граната отброса^x01 — расшвыривает людей, но не убивает. Следующую бери в ^x04спец-магазине^x01.")

        new name[32]
        get_user_name(id, name, charsmax(name))
        zlog("ГРАНАТА: выдана %s (в руках: %s)",
            name, user_has_weapon(id, CSW_HEGRENADE) ? "есть" : "НЕТ, мод забрал")
    }
}

public fw_GrenadeThink(ent)
{
    if (!get_pcvar_num(cvar_enabled) || !pev_valid(ent)) return HAM_IGNORED;

    // Взрыв ещё не наступил.
    static Float:dmgtime
    pev(ent, pev_dmgtime, dmgtime)
    if (dmgtime > get_gametime()) return HAM_IGNORED;

    new owner = pev(ent, pev_owner)
    if (!is_user_connected(owner) || !zp_get_user_zombie(owner)) return HAM_IGNORED;

    static Float:origin[3]
    pev(ent, pev_origin, origin)

    blast_effect(origin)
    new pushed = push_everyone(origin, owner)

    new name[32]
    get_user_name(owner, name, charsmax(name))
    zlog("ГРАНАТА: взрыв, бросил %s, отброшено игроков: %d", name, pushed)

    // Следующей даром НЕ БУДЕТ: здесь стояла выдача по таймеру, из-за неё зомби
    // швырялся весь раунд. Повторная — покупкой в спец-магазине.

    // Гасим штатный взрыв целиком: урон тут не нужен, только толчок.
    engfunc(EngFunc_RemoveEntity, ent)
    return HAM_SUPERCEDE;
}

// ⚠️ У всех трёх колец (TORUS, DISK, CYLINDER) раскладка байтов ОДНА и ТА ЖЕ,
// и радиус в ней задаётся не отдельным полем, а РАЗНИЦЕЙ ПО Z между двумя
// точками. Разница только в геометрии: TORUS — кольцо, лежащее на полу, DISK —
// закрашенный круг, CYLINDER — вертикальная стена.
ring(type, const Float:origin[3], Float:up, Float:radius, sprite,
     framerate, life, width, noise, r, g, b, bright)
{
    engfunc(EngFunc_MessageBegin, MSG_PVS, SVC_TEMPENTITY, origin, 0)
    write_byte(type)
    engfunc(EngFunc_WriteCoord, origin[0])
    engfunc(EngFunc_WriteCoord, origin[1])
    engfunc(EngFunc_WriteCoord, origin[2] + up)
    engfunc(EngFunc_WriteCoord, origin[0])
    engfunc(EngFunc_WriteCoord, origin[1])
    engfunc(EngFunc_WriteCoord, origin[2] + up + radius)   // радиус = дельта по Z
    write_short(sprite)
    write_byte(0)          // начальный кадр
    write_byte(framerate)  // кадров в секунду ×0.1
    write_byte(life)       // время жизни ×0.1 с
    write_byte(width)      // толщина ×0.1
    write_byte(noise)      // рваность края ×0.01
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(bright)
    write_byte(0)          // прокрутка текстуры
    message_end()
}

// Что видно на взрыве гранаты отброса.
//
// Было: одно тонкое вертикальное кольцо (толщина 1.2 при 6.0 у самого мода) и
// НИ ЗВУКА — штатный взрыв мы гасим целиком, а свой не играли. Со стороны это
// читалось как «граната не сработала».
//
// Стало: волна идёт ПО ПОЛУ, как и положено толчку, — расходящееся кольцо и
// светлое пятно под ногами. Вертикальная стена оставлена одна и потолще: с
// верхних ярусов карты плоское кольцо почти не видно. Плюс зелёная вспышка и
// низкий глухой удар.
//
// Новых файлов не нужно: shockwave.spr прекешит само ядро мода, звук штатный.
blast_effect(const Float:origin[3])
{
    new Float:radius = float(get_pcvar_num(cvar_radius))

    // Кольцо по полу — главное в эффекте: видно, докуда достаёт толчок.
    ring(TE_BEAMTORUS, origin, 6.0, radius, g_sprite_blast, 0, 5, 40, 25, 150, 255, 130, 255)

    // Пятно под эпицентром: подсказывает, откуда толкнуло.
    ring(TE_BEAMDISK, origin, 4.0, radius * 0.6, g_sprite_blast, 0, 3, 20, 0, 90, 200, 90, 140)

    // Одна вертикальная стена — чтобы волну видели и те, кто выше.
    ring(TE_BEAMCYLINDER, origin, 8.0, radius * 0.8, g_sprite_blast, 0, 4, 60, 15, 200, 255, 160, 200)

    // Вспышка: без света кольца выглядят нарисованными поверх кадра.
    engfunc(EngFunc_MessageBegin, MSG_PVS, SVC_TEMPENTITY, origin, 0)
    write_byte(TE_DLIGHT)
    engfunc(EngFunc_WriteCoord, origin[0])
    engfunc(EngFunc_WriteCoord, origin[1])
    engfunc(EngFunc_WriteCoord, origin[2])
    write_byte(28)   // радиус ×10
    write_byte(140)
    write_byte(255)
    write_byte(140)
    write_byte(6)    // время жизни ×0.1 с
    write_byte(24)   // затухание
    message_end()

    // Голос у гранаты. Тон занижен, чтобы не путали с обычной осколочной:
    // это не взрыв, а удар воздуха.
    // Через fakemeta, а не create_entity: тянуть ради одной строки весь
    // engine.inc незачем.
    new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"))
    if (pev_valid(ent))
    {
        engfunc(EngFunc_SetOrigin, ent, origin)
        emit_sound(ent, CHAN_STATIC, SND_BLAST, VOL_NORM, 0.5, 0, 70)
        set_task(1.5, "drop_sound_ent", ent)
    }
}

// Звук живёт на своей сущности: у гранаты его играть уже негде — она в этот
// момент удаляется, и звук обрывается на первом кадре.
public drop_sound_ent(ent)
{
    if (pev_valid(ent)) engfunc(EngFunc_RemoveEntity, ent)
}

push_everyone(const Float:origin[3], owner)
{
    new Float:radius = float(get_pcvar_num(cvar_radius))
    new Float:force = float(get_pcvar_num(cvar_force))
    new bool:selfpush = get_pcvar_num(cvar_selfpush) != 0
    new pushed = 0

    new players[32], num
    get_players(players, num, "a")

    for (new i = 0; i < num; i++)
    {
        new id = players[i]

        // Своих не двигаем, кроме самого метателя — если это разрешено.
        if (zp_get_user_zombie(id))
        {
            if (id != owner || !selfpush) continue;
        }

        static Float:pos[3]
        pev(id, pev_origin, pos)

        static Float:dir[3]
        xs_vec_sub(pos, origin, dir)
        new Float:dist = vector_length(dir)
        if (dist > radius) continue;

        // Ближе к центру — сильнее. У самого эпицентра направление вырождается,
        // поэтому там просто подбрасываем вверх.
        new Float:power = force * (1.0 - dist / radius)
        if (dist < 1.0)
        {
            dir[0] = 0.0
            dir[1] = 0.0
            dir[2] = 1.0
        }
        else
        {
            xs_vec_mul_scalar(dir, 1.0 / dist, dir)
            dir[2] += 0.45   // добавляем вверх, иначе игрока просто протащит по полу
        }

        static Float:vel[3]
        pev(id, pev_velocity, vel)
        vel[0] += dir[0] * power
        vel[1] += dir[1] * power
        vel[2] += dir[2] * power
        set_pev(id, pev_velocity, vel)
        pushed++
    }

    return pushed;
}

// Небольшие векторные помощники — тянуть ради них xs.inc целиком незачем.
xs_vec_sub(const Float:a[3], const Float:b[3], Float:out[3])
{
    out[0] = a[0] - b[0]
    out[1] = a[1] - b[1]
    out[2] = a[2] - b[2]
}

xs_vec_mul_scalar(const Float:a[3], Float:k, Float:out[3])
{
    out[0] = a[0] * k
    out[1] = a[1] * k
    out[2] = a[2] * k
}

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл, а не в общий журнал сервера:
// в нём они тонут между строками движка, а консоль уезжает за секунды.
// Файл: addons/amxmodx/logs/zp_actions.log
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
