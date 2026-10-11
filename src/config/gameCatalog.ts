import type { DomainDefinition } from '../types';

export const domains: DomainDefinition[] = [
  {
    id: 'gaze',
    name: '注视同步性',
    place: '超市大忙碌',
    icon: '🛒',
    color: '#2b7a78',
    pale: '#dff4ee',
    description: '一起找、一起看、一起完成小镇订单。',
    games: [
      { id: 'GAZE_01', name: '补货大作战', subtitle: '找到发亮商品，两个人一起按住', icon: '📦', status: 'demo-ready' },
      { id: 'GAZE_02', name: '购物小帮手', subtitle: '根据顾客需要共同寻找商品', icon: '🛍️', status: 'demo-ready' },
      { id: 'GAZE_03', name: '你买我来卖', subtitle: '轮流做顾客和店员', icon: '🏪', status: 'demo-ready' },
    ],
  },
  {
    id: 'touch',
    name: '触摸同步性',
    place: '乐园大冒险',
    icon: '🎡',
    color: '#3878c8',
    pale: '#e2efff',
    description: '用长按、节奏和滑动让游乐园动起来。',
    games: [
      { id: 'TOUCH_01', name: '气球飞上天', subtitle: '共同长按', icon: '🎈', status: 'demo-ready' },
      { id: 'TOUCH_02', name: '音乐喷泉秀', subtitle: '节奏点击', icon: '⛲', status: 'demo-ready' },
      { id: 'TOUCH_03', name: '欢乐漂流记', subtitle: '共同滑动', icon: '🛶', status: 'demo-ready' },
      { id: 'TOUCH_04', name: '彩虹过山车', subtitle: '同步描线', icon: '🎢', status: 'demo-ready' },
      { id: 'TOUCH_05', name: '飞行小飞机', subtitle: '领航跟随', icon: '✈️', status: 'planned' },
    ],
  },
  {
    id: 'language',
    name: '语言同步性',
    place: '小镇有话说',
    icon: '💬',
    color: '#d27458',
    pale: '#fff0e8',
    description: '轮流表达、认真回应，一起解决小镇任务。',
    games: [
      { id: 'LANG_01', name: '神秘新朋友', subtitle: '自由问答和人物推理', icon: '🕵️', status: 'planned' },
      { id: 'LANG_02', name: '画报找不同', subtitle: '描述、询问和共同确认', icon: '🖼️', status: 'planned' },
      { id: 'LANG_03', name: '小镇角色秀', subtitle: '完成生活情境对话', icon: '🎭', status: 'planned' },
    ],
  },
  {
    id: 'emotion',
    name: '情绪同步性',
    place: '小镇心情屋',
    icon: '🏡',
    color: '#8b62aa',
    pale: '#f2e9fb',
    description: '看故事、做表情、学习温柔的调节方法。',
    games: [
      { id: 'EMO_01', name: '小镇心情故事', subtitle: '独立选择，再一起聊聊', icon: '📖', status: 'planned' },
      { id: 'EMO_02', name: '情绪模仿秀', subtitle: '轮流完成指定表情任务', icon: '📷', status: 'planned' },
      { id: 'EMO_03', name: '心情加油站', subtitle: '共同练习调节方法', icon: '🌿', status: 'planned' },
    ],
  },
];

export const implementationStatus = {
  phase: '阶段 0 + 阶段 A + 阶段 C 样板',
  version: '0.1.0-prototype',
  notice: '《超市大忙碌》三个游戏与《气球飞上天》《音乐喷泉秀》《欢乐漂流记》《彩虹过山车》已接入可运行原型；其余模块按后续开发阶段接入。',
};
