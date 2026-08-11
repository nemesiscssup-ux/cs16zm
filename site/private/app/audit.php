<?php
/**
 * Журнал действий.
 *
 * Пишем всё, что меняет права на игровом сервере или касается входа в панель.
 * Без этого «у меня забрали админку» — спор без доказательств, а подобранный
 * пароль к панели вообще не оставляет следа.
 *
 * Журнал не должен ронять действие: если запись в него не удалась, работа
 * продолжается. Потерянная строка журнала — беда; отменённая из-за неё выдача
 * оплаченной привилегии — беда крупнее.
 */

function audit($action, $target = '', $detail = null, $who = null)
{
    try {
        if ($who === null) {
            $who = function_exists('current_admin') && current_admin() ? current_admin()['login'] : '';
        }
        q(
            'INSERT INTO zm_audit (at, who, ip, action, target, detail) VALUES (NOW(), ?, ?, ?, ?, ?)',
            array(
                (string)$who,
                client_ip(),
                (string)$action,
                (string)$target,
                is_string($detail) || $detail === null ? $detail : json_encode($detail, JSON_UNESCAPED_UNICODE),
            )
        );
    } catch (Throwable $e) {
        error_log('журнал не записан: ' . $e->getMessage());
    }
}
