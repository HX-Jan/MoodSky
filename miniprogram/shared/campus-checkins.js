// Recommendations only: no location permission, arrival verification or opening-hour claim.
const PLACES = Object.freeze(
  [
    {
      placeId: 'fzu-qishan-fuyou-pavilion',
      name: '福友阁',
      tag: '散步 · 阅读',
      description: '沿竹间小道走走，找个座位歇一会儿。',
      directions: '从晋江楼沿科技园方向前行，在右侧小路口进入，沿小路前往福友阁。',
    },
    {
      placeId: 'fzu-qishan-dameng-bookhouse',
      name: '大梦书屋',
      tag: '阅读 · 独处',
      description: '带上一本书，留一点安静的时间。',
      directions: '从图书馆外部大楼梯上至二楼，寻找大梦书屋门头。',
    },
    {
      placeId: 'fzu-qishan-wangshu-lake',
      name: '望舒湖',
      tag: '散步 · 短休',
      description: '去湖边看看，换一换眼前的风景。',
      directions: '位于生活一区与五区之间，可沿路边人行道前往湖边。',
    },
    {
      placeId: 'fzu-qishan-sunshine-garden',
      name: '阳光园',
      tag: '散步 · 短休',
      description: '在校园里走一段，让脚步慢下来。',
      directions: '晋江楼对面；从图书馆前往文楼途中右侧大入口进入',
    },
    {
      placeId: 'fzu-qishan-guangcai-cafe',
      name: '光彩创咖',
      tag: '阅读 · 短休',
      description: '找个地方坐坐，和朋友聊一聊。',
      directions: '学生活动中心一层，进入大门后向右走，店门口有立牌',
    },
  ].map((place) => Object.freeze(place)),
);
module.exports = { PLACES };
