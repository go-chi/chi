# @deepseek-ai/dsh-client-ui-attachment

[English](README.md) | 中文

纯 React 附件原子组件（零 cordis）：输入框草稿图片栏（`AttachmentRail`）、聊天历史图片画廊（`MessageImage`/`ImageGallery`）、原图灯箱（`ImageLightbox`）与整页拖放遮罩（`DropOverlay`）。所有文案都由持有方插件在自己的语言命名空间中解析后经 label props 传入，此包不读取任何应用状态；当前消费者是 `@deepseek-ai/dsh-client-ui-conversation`，经其 `image-labels` 模块桥接 `conversation` 词典。

## 附件栏

`AttachmentRail` 将待发送草稿图片渲染为固定 64px（16px 圆角）的缩略图横排，滚动条始终隐藏，溢出改由两端的圆形箭头提示：每次翻页滚动一个视口宽度（减去一张卡片作为上下文，下限 200px）并平滑滚动（`prefers-reduced-motion: reduce` 下瞬时完成），箭头的显隐在滚动、条目数量变化和栏自身尺寸变化时依据滚动几何重算（rail 元素上的 ResizeObserver，因此侧栏、面板的宽度变化也计入，不只是窗口尺寸变化）。附件栏只允许横向滚动：非 passive 监听器消费所有带纵向分量的滚轮事件——不会滚动输入框背后的会话记录——纯纵向滚轮转为横向步进（LINE/PAGE 单位先归一化为像素，单次行程钳制在 60px 内），对角平移保留其横向分量，纯横向平移保持原生滚动。新增条目会滚动到栏尾展示，删除则保持原位，带着已有草稿重新挂载的栏保持起始位置。每张缩略图单击经 `onOpen` 打开原图，删除按钮位于卡片内部右上角，悬停卡片或键盘聚焦时才显示；粗指针（触屏）设备没有悬停，因此常显。是否挂载由持有方决定，仅在有条目时渲染。

## 消息图片与灯箱

`MessageImage` 渲染一张持久化历史图片，经持有方的 `ImageLoader` 加载会话授权 URL；加载失败渲染显式重试按钮，加载完成后单击打开 `ImageLightbox`（加载中的点击被忽略）。尺寸规则对齐 DeepSeek Chat：一条消息仅有的一张图（`variant="single"`）长边 240px、展示宽高比钳制在 [0.25, 4] 之间——超出部分由 `object-fit: cover` 裁切，特别高的图锚定顶部、特别宽的图锚定左侧——且从不放大超过原始尺寸；多图中的一张（`variant="tile"`）为固定 64px 方块。`ImageGallery` 将一条消息的图片包为一个对齐的可换行弹性分组（用户消息 `end`，助手消息 `start`），按图片数量选择 variant，空列表不渲染。`ImageLightbox` 是文档级模态预览，铺在共享的对话框遮罩上（`--dsw-alias-bg-mask-1` 加 `--dsw-mask-blur`，画在独立图层上，模糊不会波及预览图本身），按 Escape、按下遮罩或点关闭按钮均可关闭，卸载时将焦点还给打开者。

## 拖放遮罩

`DropOverlay` 是文件拖拽悬停页面时的全视口邀请层：插画、标题，接受拖放时再加一行上限说明（`disabled` 换为禁用插画并隐藏上限行）。该层不接收指针事件——持有方的 document 级拖拽监听器负责 enter/leave 计数和接受与否的判定；遮罩只呈现状态。与灯箱一样经 body portal 渲染。

## 模型体验

无。该包（package）在浏览器中渲染纯 React 原子组件；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅支持图片** — 非图片文件尚无附件栏卡片与历史渲染；DeepSeek Chat 风格的文件卡片和上传进度状态等输入框接受非图片附件后再做。
- **灯箱无缩放与下载** — 预览仅以适配视口的尺寸渲染原图。
- **灯箱不锁定焦点** — 它设置 `aria-modal` 并在关闭时归还焦点，但 Tab 仍可移动到背后的页面（沿袭入包前组件的行为）。
