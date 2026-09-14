import { ApiError } from './api';

/** 把接口错误码翻成人话 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'locked':
        return '已过截止时间（每天下午 3 点截第二天的单），不能改了';
      case 'duplicate':
        return '这一天已经订过了';
      case 'no_menu':
        return '这一天还没发布菜单';
      case 'not_found':
        return '没找到对应记录（可能在别的设备上退掉了）';
      case 'bad_code':
        return '取餐码是 6 位数字';
      case 'bad_menu':
        return e.message || '菜单格式不对';
      default:
        return e.message || '出错了，请重试';
    }
  }
  return '连不上本机服务——窗口机器上的服务程序是不是没开？';
}
