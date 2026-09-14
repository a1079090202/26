/** 日期字符串，格式 YYYY-MM-DD，一律指本地日期（不用 UTC） */
export type ISODate = string;

export type Choice = 'A' | 'B';

export interface MealOption {
  name: string;
  price: number; // 元
}

export interface MenuDay {
  date: ISODate;
  A: MealOption;
  B: MealOption;
}

/** 一周菜单：周一到周五 5 天，id 是周一的日期 */
export interface MenuWeek {
  id: ISODate;
  publishedAt: string;
  days: MenuDay[];
}

export type OrderStatus = 'active' | 'redeemed' | 'void';

export interface Order {
  id: string;
  /** 订餐人标识：有工号用 "E:工号"，否则 "N:姓名" */
  personKey: string;
  name: string;
  empId?: string;
  date: ISODate;
  choice: Choice;
  /** 下单时的价格快照，菜单后来改了也不影响已下的单 */
  price: number;
  /** 6 位取餐码，当天唯一 */
  code: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  redeemedAt?: string;
}

export interface Store {
  menus: MenuWeek[];
  orders: Order[];
}
