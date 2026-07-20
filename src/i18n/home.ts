export type Lang = "zh" | "en";

export const homeCopy = {
	zh: {
		title: "Chen Wang｜Home",
		description: "Chen Wang 的个人网站。世界的有趣，我很好奇。",
		greeting: "你好",
		intro: [
			"我是王琛，一个体验设计师，相信设计能让这个世界变得更美好一点；",
			"我喜欢探索世界，包括旅行、长距离徒步和越野跑。我在世界的各个角落游走，偶尔发现某块拼图可以拼到自己身上；",
			"我喜欢和人聊天，也做一个对谈类播客。我在多个跨文化环境中生活过，也一直对多元文化很感兴趣。",
		],
		wechatAlt: "微信二维码：扫码添加小琛为朋友",
		larkAlt: "飞书二维码：扫码添加王琛为联系人",
		factsTitle: "Some fun facts about me",
		factsIntro: "一些关于我的小事",
		funFacts: [
			"16 岁就上大学了",
			"在 5 个国家长期生活过，旅行过二十几个国家",
			"政治面貌：民主党派 · 中国民主促进会会员",
			"能做引体向上和靠墙手倒立",
		],
		recsTitle: "书影音推荐",
		recsIntro: "如果我们品味相似那么我们一定能做朋友",
		recommendations: [
			{
				id: "screen",
				label: "SCREEN",
				title: "剧与电影",
				items: [
					"EVA",
					"星际牛仔",
					"葬送的芙莉莲",
					"败局启示录",
					"机器人之梦",
					"狗神",
					"奥本海默",
					"不死法医",
					"Flow",
				],
			},
			{
				id: "books",
				label: "BOOKS",
				title: "书",
				items: [
					"银河帝国系列",
					"太白金星有点烦",
					"夜晚的潜水艇",
					"十日终焉",
					"我在北京送快递",
					"人生由我",
					"哲学的慰藉",
					"中央帝国的哲学密码",
					"夜航西飞",
					"阳明学述要",
					"中年之路",
					"反脆弱",
					"存在主义心理治疗",
				],
			},
			{
				id: "music",
				label: "MUSIC",
				title: "音乐",
				items: [
					"陈粒",
					"泽野弘之",
					"杨昊昆",
					"Of Monsters And Men",
					"要不要买菜",
				],
			},
		],
		momentsTitle: "这都是我",
		momentsIntro: "在探索世界的过程中，更好地了解自己",
	},
	en: {
		title: "Chen Wang｜Home",
		description:
			"The personal site of Chen Wang. Curious about the world's wonder.",
		greeting: "Hello",
		intro: [
			"I'm Chen Wang, an experience designer who believes design can make the world a little better.",
			"I love exploring the world through travel, long-distance hiking, and trail running. I wander through different corners of the earth, and occasionally find a piece that fits me.",
			"I love talking with people, and I also host a conversation podcast. I've lived in multiple cross-cultural environments and have always been curious about diverse cultures.",
		],
		wechatAlt: "WeChat QR code — scan to add Xiao Chen as a friend",
		larkAlt: "Lark QR code — scan to add Chen Wang as a contact",
		factsTitle: "Some fun facts about me",
		factsIntro: "A few small things about me",
		funFacts: [
			"Started university at 16",
			"Lived long-term in 5 countries, and traveled to more than twenty",
			"Political affiliation: member of the China Association for Promoting Democracy",
			"Can do pull-ups and a wall handstand",
		],
		recsTitle: "Favorites",
		recsIntro: "If our tastes overlap, we're probably destined to be friends",
		recommendations: [
			{
				id: "screen",
				label: "SCREEN",
				title: "Shows & Films",
				items: [
					"EVA",
					"Cowboy Bebop",
					"Frieren: Beyond Journey's End",
					"The Fallen",
					"Robot Dreams",
					"God of Dogs",
					"Oppenheimer",
					"Pushing Daisies",
					"Flow",
				],
			},
			{
				id: "books",
				label: "BOOKS",
				title: "Books",
				items: [
					"Foundation series",
					"Tai Bai Jin Xing Is a Bit Annoyed",
					"The Night Submarine",
					"Doomsday of Ten Days",
					"Delivering Packages in Beijing",
					"Owning My Life",
					"The Consolations of Philosophy",
					"The Philosophical Cipher of the Central Empire",
					"West with the Night",
					"Essentials of Yangming Learning",
					"The Midlife Path",
					"Antifragile",
					"Existential Psychotherapy",
				],
			},
			{
				id: "music",
				label: "MUSIC",
				title: "Music",
				items: [
					"Chen Li",
					"Hiroyuki Sawano",
					"Yang Haokun",
					"Of Monsters And Men",
					"Yao Bu Yao Mai Cai",
				],
			},
		],
		momentsTitle: "This is me",
		momentsIntro: "Exploring the world, and getting to know myself better along the way.",
	},
} as const;

export const footerQuote = {
	zh: "世界的有趣，我很好奇",
	en: "Curious about the world's wonder",
} as const;

export const photoCaptions: Record<string, { zh: string; en: string }> = {
	rec27MU2uaWMol: {
		zh: "杭州 · 越野跑",
		en: "Hangzhou · Trail running",
	},
	rec27MU2uaWQV5: {
		zh: "清迈 · 野攀",
		en: "Chiang Mai · Outdoor climbing",
	},
	rec27MU2uaWTS6: {
		zh: "乞力马扎罗 · 徒步",
		en: "Kilimanjaro · Hiking",
	},
	rec27MU2uaWWoD: {
		zh: "给人像摄影师朋友客串一日模特",
		en: "Guest modeling for a day for a portrait photographer friend",
	},
	rec27MU2uaWZ6C: {
		zh: "在 IXDC 做分享",
		en: "Speaking at IXDC",
	},
	recvpm1RjzUwAY: {
		zh: "泰妹 · 一小时体验卡",
		en: "Thai girl · One-hour experience pass",
	},
	recvpm3JafnzWk: {
		zh: "客串一个工作坊导师",
		en: "Guest starring as a workshop mentor",
	},
	recvpp9PiqyKjy: {
		zh: "西班牙 · 出差",
		en: "Spain · Business trip",
	},
};

export const shellCopy = {
	zh: {
		navLabel: "主导航",
		homeLabel: "回到首页",
		langLabel: "语言切换",
	},
	en: {
		navLabel: "Main navigation",
		homeLabel: "Back to home",
		langLabel: "Language",
	},
} as const;
