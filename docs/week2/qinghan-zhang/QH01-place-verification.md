# QH01｜首批地点资料与来源

- **状态：进行中**（已整理 5 条成员提交记录，来源对应及字段复核未完成）
- **关联需求：**校园列表、筛选和详情（UW3-F11、UW3-F12、UW3-F13；最终追踪关系待项目负责人确认）
- **协作人：**Junhan Huang（复核启用条件）
- **拟复核人：**Junhan Huang；依用户要求，本次尚未执行组员复核
- **版本：**MoodSky `0.2.2`
- **环境：**本地整理；来源链接来自成员填写的资料，未在本次工作中独立访问验证
- **成果路径：**`docs/week2/qinghan-zhang/QH01-place-verification.md`、`docs/week2/qinghan-zhang/evidence/`、`miniprogram/modules/campus/field-note-places.js`
- **实际耗时：**待成员本人填写
- **验收状态：**进行中；当前记录只用于本地预览，不是正式地点启用审批

## 候选地点与可用表述

| 编号 | 地点 | 校园地图线索 | 成员记录的区域说明 | 当前资料状态 |
|---|---|---|---|---|
| P01 | 福友阁 | 地图有地点专属页 | 旗山校区东门至科技园方向道路附近，入口靠近路边路口 | 位置有地图线索；开放时段来自成员提供的小红书记录，待复核 |
| P02 | 大梦书屋 | 地图结果为图书馆 | 图书馆二楼入口对面；成员记录称从外部楼梯上至二楼后入口在左手边 | 位置以图书馆标注和成员说明为线索；开放时间来源编号错误，待更正 |
| P03 | 望舒湖（常用称呼：不三不四湖） | 地图首页未找到该地点专属标注 | 学生生活区丁香园食堂右侧湖区，成员记录有湖边草地 | 地点称呼和区域说明来自成员记录；地图线索不足，待复核 |
| P04 | 阳光园 | 地图有地点专属页 | 晋江楼对面的开放区域，成员记录有多个入口 | 地图支持区域线索；现场核验方法误填成另一地点，待本人更正 |
| P05 | 光彩创咖 | 地图标注到学生活动中心 | 学生活动中心内右侧 | 具体位置和营业时间来源编号待整理；地图只支持到活动中心 |

本地记录统一保留 `verificationStatus: pending_review`、`verifiedAt: null`、`validUntil: null`、`location: null`，页面显示成员记录日期而非正式核验日期。现阶段没有任何一条记录可直接作为“已核验并推荐前往”的正式地点。

## 来源索引

| 来源 | 对应地点 | 来源类型 | 链接 | 支持范围及备注 |
|---|---|---|---|---|
| S1 | P01 | 福州大学校园地图 | [福友阁地图详情](https://map.fzu.edu.cn/#/detail/fireBound/262622) | 成员记录称地图显示福友阁位置和外观 |
| S2 | P01 | 小红书具体帖子 | [福友阁帖子](https://www.xiaohongshu.com/explore/6810c5eb00000000230031b2?xsec_token=ABkQA_4eudZDUR5X37g2JzvMVjV69kW9HOov5jXH5h49k%3D&xsec_source=pc_search&source=web_search_result_notes) | 成员记录称帖子含室内照片及室内时段；需复核内容是否仍适用 |
| S3 | P02 | 福州大学校园地图 | [图书馆地图详情](https://map.fzu.edu.cn/#/detail/fireBound/74469) | 支持图书馆位置，不单独证明大梦书屋入口或开放时段 |
| S4 | P02 | 小红书具体帖子 | [大梦书屋帖子](https://www.xiaohongshu.com/explore/6a6ca7a40000000033030436?xsec_token=ABv4zHen8GA5Ubl5nogpxKr5XcB6xqaEQ0e6oav-0aM_g%3D&xsec_source=pc_search&source=web_search_result_notes) | 成员记录称含室内外区域、书店、自习区和餐吧信息 |
| S5 | P03 | 福州大学校园地图首页 | [旗山校区地图](https://map.fzu.edu.cn/#/home?campus=74349) | 目前仅为校区地图入口；未提供可定位湖区的专属标注 |
| S6 | P03 | 小红书具体帖子 | [望舒湖相关帖子](https://www.xiaohongshu.com/explore/6a9ba0440000000027014380?xsec_token=ABPqD9ZNaZ665aNaqZDP5GPR7-qB-2wPbSRDXqmCLfYt0%3D&xsec_source=pc_search&source=web_search_result_notes) | 成员记录称帖子描述生活区湖景；不单独证明开放时段 |
| S7 | P04 | 福州大学校园地图 | [阳光园地图详情](https://map.fzu.edu.cn/#/detail/fireBound/79120) | 成员记录称显示晋江楼对面区域 |
| S8 | P04 | 小红书具体帖子 | [阳光园帖子](https://www.xiaohongshu.com/explore/693661a5000000001f00f4be?xsec_token=ABNP0V7M0iKyTneakkBCWxJA-_DLP_JMIDuLRf9LnmokQ%3D&xsec_source=pc_search&source=web_search_result_notes) | 成员记录称描述晋江楼对面区域 |
| S9 | P05 | 福州大学校园地图 | [学生活动中心地图详情](https://map.fzu.edu.cn/#/detail/fireBound/74747) | 支持学生活动中心位置，不单独定位内部创咖 |
| S10 | P05 | 小红书个人主页 | [账号主页](https://www.xiaohongshu.com/user/profile/6698bb91000000000f03685c?xsec_token=ABoOum2FbPyX23taOMBtcV5xcERNuSz0oVajAHkwiBvJo%3D&xsec_source=pc_user) | 这是主页链接，不是具体地点帖子，不能单独支持营业时间和店内内容 |
| S11 | P05 | 小红书具体帖子（从 P05 记录中拆出） | [光彩创咖帖子](https://www.xiaohongshu.com/explore/68d21b370000000012022430?xsec_token=ABKuq6aZO-OYBcYoeWvGLCpZlB6M2lz45wR_0DrHcm8O0%3D&xsec_source=pc_search&source=web_search_result_notes) | 成员记录称帖子描述饮品、店内布置和自习；需复核营业时段字段 |

候选索引还出现一个未对应到详细记录的 P03 小红书链接：`https://www.xiaohongshu.com/explore/6ad839f90000000032016987?...`。因资料表没有给出可对应的来源编号和字段，本次不将它并入 S6；由成员确认是否为误填或补充来源。

## 待本人更正的资料冲突

1. P01、P02、P03 的索引和详细记录各自出现不同的坐标参考值；同时未能确认所用坐标系。小程序数据已将坐标留空，不提供地图导航。
2. P02 开放时间引用了 P01 的来源编号 S2；P02 具体帖子 S4 的记录内容没有明确支持该时间。
3. P03 地图首页没有地点专属标注；索引中的另一条小红书链接未出现在详细来源表中。
4. P04 的现场核验方法误写成步行至福友阁；P04 开放时间也误引 S2。两项均不能作为阳光园的直接证据。
5. P05 的现场核验方法误写成步行至福友阁；来源表把个人主页链接记为来源，详细记录另有具体帖子链接。已将具体帖子单列为 S11，仍需成员确认来源归属和营业时段。
6. 所有地点的“完全属实”等概括性表述没有拆成可逐项复核的直接观察事实。正式启用前应按入口、室内/室外范围、限制和开放字段分别确认。

开放时间在本地资料中保留为“成员记录，待复核”的摘要；来源或记录存在错误时会直接显示待核验说明。来源网页和成员现场记录均未由本次任务独立复查。图片仅作为识别资料归档，不将图片当作营业时间或准确导航依据。

## 图片归档

随成员填写的记录共收到 19 个图片文件，现复制到本目录 `evidence/`。文件与候选地点的对应按原模板中的文件名记录：

- P01：`image.png`；福友阁 4 张 JPG（文件名以“福友阁”开头）。
- P02：`image-1.png` 至 `image-5.png`。
- P03：`image-6.png`。
- P04：`image-7.png` 至 `image-11.png`。
- P05：`image-12.png` 至 `image-14.png`。

这些图片归档自用户提供的资料。本次没有将图片引用写入校园地点云端字段或小程序页面。
