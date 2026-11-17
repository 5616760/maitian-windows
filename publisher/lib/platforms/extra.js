// 扩展点：在这里注册额外的平台适配器（比如自己的网站）。
// 本地 fork：注册微信公众号图文适配器（platforms/weixin.js）。
import weixin from './weixin.js';
export const adapters = { weixin };
