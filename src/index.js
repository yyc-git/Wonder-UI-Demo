var TinySDF = (function () {


    var INF = 1e20;

    function TinySDF(fontSize, buffer, radius, cutoff, fontFamily, fontWeight) {
        this.fontSize = fontSize || 24;
        this.buffer = buffer === undefined ? 3 : buffer;
        this.cutoff = cutoff || 0.25;
        this.fontFamily = fontFamily || 'sans-serif';
        this.fontWeight = fontWeight || 'normal';
        this.radius = radius || 8;
        var size = this.size = this.fontSize + this.buffer * 2;

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvas.height = size;

        this.ctx = this.canvas.getContext('2d');
        this.ctx.font = this.fontWeight + ' ' + this.fontSize + 'px ' + this.fontFamily;
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = 'black';

        // temporary arrays for the distance transform
        this.gridOuter = new Float64Array(size * size);
        this.gridInner = new Float64Array(size * size);
        this.f = new Float64Array(size);
        this.z = new Float64Array(size + 1);
        this.v = new Uint16Array(size);

        // hack around https://bugzilla.mozilla.org/show_bug.cgi?id=737852
        this.middle = Math.round((size / 2) * (navigator.userAgent.indexOf('Gecko/') >= 0 ? 1.2 : 1));
    }

    TinySDF.prototype.draw = function (char) {
        this.ctx.clearRect(0, 0, this.size, this.size);
        this.ctx.fillText(char, this.buffer, this.middle);

        var imgData = this.ctx.getImageData(0, 0, this.size, this.size);
        var alphaChannel = new Uint8ClampedArray(this.size * this.size);

        for (var i = 0; i < this.size * this.size; i++) {
            var a = imgData.data[i * 4 + 3] / 255; // alpha value
            this.gridOuter[i] = a === 1 ? 0 : a === 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
            this.gridInner[i] = a === 1 ? INF : a === 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
        }

        edt(this.gridOuter, this.size, this.size, this.f, this.v, this.z);
        edt(this.gridInner, this.size, this.size, this.f, this.v, this.z);

        for (i = 0; i < this.size * this.size; i++) {
            var d = Math.sqrt(this.gridOuter[i]) - Math.sqrt(this.gridInner[i]);
            alphaChannel[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / this.radius + this.cutoff))));
        }

        return alphaChannel;
    };

    // 2D Euclidean squared distance transform by Felzenszwalb & Huttenlocher https://cs.brown.edu/~pff/papers/dt-final.pdf
    function edt(data, width, height, f, v, z) {
        for (var x = 0; x < width; x++) edt1d(data, x, width, height, f, v, z);
        for (var y = 0; y < height; y++) edt1d(data, y * width, 1, width, f, v, z);
    }

    // 1D squared distance transform
    function edt1d(grid, offset, stride, length, f, v, z) {
        var q, k, s, r;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;

        for (q = 0; q < length; q++) f[q] = grid[offset + q * stride];

        for (q = 1, k = 0, s = 0; q < length; q++) {
            do {
                r = v[k];
                s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
            } while (s <= z[k--]);

            k += 2;
            v[k] = q;
            z[k] = s;
            z[k + 1] = INF;
        }

        for (q = 0, k = 0; q < length; q++) {
            while (z[k + 1] < q) k++;
            r = v[k];
            grid[offset + q * stride] = f[r] + (q - r) * (q - r);
        }
    }

    return TinySDF;
})();

function potpack(boxes) {
    // calculate total box area and maximum box width
    let area = 0;
    let maxWidth = 0;

    for (const box of boxes) {
        area += box.w * box.h;
        maxWidth = Math.max(maxWidth, box.w);
    }

    // sort the boxes for insertion by height, descending
    boxes.sort((a, b) => b.h - a.h);

    // aim for a squarish resulting container,
    // slightly adjusted for sub-100% space utilization
    const startWidth = Math.max(Math.ceil(Math.sqrt(area / 0.95)), maxWidth);

    // start with a single empty space, unbounded at the bottom
    const spaces = [{ x: 0, y: 0, w: startWidth, h: Infinity }];

    let width = 0;
    let height = 0;

    for (const box of boxes) {
        // look through spaces backwards so that we check smaller spaces first
        for (let i = spaces.length - 1; i >= 0; i--) {
            const space = spaces[i];

            // look for empty spaces that can accommodate the current box
            if (box.w > space.w || box.h > space.h) continue;

            // found the space; add the box to its top-left corner
            // |-------|-------|
            // |  box  |       |
            // |_______|       |
            // |         space |
            // |_______________|
            box.x = space.x;
            box.y = space.y;

            height = Math.max(height, box.y + box.h);
            width = Math.max(width, box.x + box.w);

            if (box.w === space.w && box.h === space.h) {
                // space matches the box exactly; remove it
                const last = spaces.pop();
                if (i < spaces.length) spaces[i] = last;

            } else if (box.h === space.h) {
                // space matches the box height; update it accordingly
                // |-------|---------------|
                // |  box  | updated space |
                // |_______|_______________|
                space.x += box.w;
                space.w -= box.w;

            } else if (box.w === space.w) {
                // space matches the box width; update it accordingly
                // |---------------|
                // |      box      |
                // |_______________|
                // | updated space |
                // |_______________|
                space.y += box.h;
                space.h -= box.h;

            } else {
                // otherwise the box splits the space into two spaces
                // |-------|-----------|
                // |  box  | new space |
                // |_______|___________|
                // | updated space     |
                // |___________________|
                spaces.push({
                    x: space.x + box.w,
                    y: space.y,
                    w: space.w - box.w,
                    h: box.h
                });
                space.y += box.h;
                space.h -= box.h;
            }
            break;
        }
    }

    return {
        w: width, // container width
        h: height, // container height
        fill: (area / (width * height)) || 0 // space utilization
    };
}



var index = (function () {
    function createShader(gl, type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    function createProgram(gl, vertexSource, fragmentSource) {
        var program = gl.createProgram();

        var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
        var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }

        var wrapper = { program: program };

        var numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (var i = 0; i < numAttributes; i++) {
            var attribute = gl.getActiveAttrib(program, i);
            wrapper[attribute.name] = gl.getAttribLocation(program, attribute.name);
        }
        var numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < numUniforms; i++) {
            var uniform = gl.getActiveUniform(program, i);
            wrapper[uniform.name] = gl.getUniformLocation(program, uniform.name);
        }

        return wrapper;
    }



    function _isCJK(char) {
        return char >= 0x4E00 && char <= 0x9FFF;
    }





    // function updateSDF(canvas, ctx) {
    function updateSDF() {
        // var chars = "赊1234567890-=！@#￥%……&*()~:\"{}[]|\?/<>,.;' +abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ阿啊哎哀腮叁搔骚臊涩瑟鲨煞霎筛删煽擅赡裳晌捎贞斟疹怔狰筝拯吱侄帜挚秩掷窒滞稚衷粥肘帚咒昼拄瞩蛀铸拽撰妆幢椎锥坠缀赘谆卓拙灼茁浊酌啄琢咨姊揍卒";
        // var chars = "阿啊哎哀唉埃挨癌矮艾爱碍安氨俺岸按案暗昂凹熬傲奥澳八巴叭吧拔把坝爸罢霸白百柏摆败拜班般颁斑搬板版办半伴扮瓣邦帮膀傍棒包胞宝饱保堡报抱豹暴爆卑杯悲碑北贝备背倍被辈奔本崩逼鼻比彼笔币必毕闭辟碧蔽壁避臂边编蝙鞭扁便变遍辨辩标表别宾滨冰兵丙柄饼并病拨波玻剥播脖伯驳泊勃博搏膊薄卜补捕不布步部擦猜才材财裁采彩踩菜蔡参餐残蚕惨灿仓苍舱藏操曹槽草册侧测策层叉插查茶察差拆柴缠产阐颤昌长肠尝偿常厂场畅倡唱抄超巢朝潮吵炒车扯彻撤尘臣沉陈闯衬称趁撑成呈承诚城乘惩程橙吃池驰迟持匙尺齿斥赤翅充冲虫崇抽仇绸愁筹酬丑瞅臭出初除厨础储楚处触川穿传船喘串窗床晨创吹垂锤春纯唇醇词瓷慈辞磁雌此次刺从匆葱聪丛凑粗促催脆翠村存寸措错搭达答打大呆代带待袋逮戴丹单担胆旦但诞弹淡蛋氮当挡党荡刀导岛倒蹈到盗道稻得德的灯登等邓凳瞪低堤滴迪敌笛底抵地弟帝递第颠典点电店垫淀殿雕吊钓调掉爹跌叠蝶丁叮盯钉顶订定丢东冬懂动冻洞都斗抖陡豆督毒读独堵赌杜肚度渡端短段断锻堆队对吨敦蹲盾顿多夺朵躲俄鹅额恶饿鳄恩儿而尔耳二发乏伐罚阀法帆番翻凡烦繁反返犯泛饭范贩方坊芳防妨房肪仿访纺放飞非啡菲肥废沸肺费分纷芬坟粉份奋愤粪丰风枫封疯峰锋蜂冯逢缝凤奉佛否夫肤孵弗伏扶服浮符幅福辐蝠抚府辅腐父付妇负附复赴副傅富赋腹覆该改钙盖溉概干甘杆肝赶敢感刚岗纲缸钢港高搞稿告戈哥胳鸽割歌阁革格葛隔个各给根跟更耕工弓公功攻供宫恭巩拱共贡勾沟钩狗构购够估咕姑孤菇古谷股骨鼓固故顾瓜刮挂拐怪关观官冠馆管贯惯灌罐光广归龟规硅轨鬼柜贵桂滚棍郭锅国果裹过哈孩海害含函寒韩罕喊汉汗旱杭航毫豪好号浩耗呵喝合何和河核荷盒贺褐赫鹤黑嘿痕很狠恨哼恒横衡轰哄红宏洪虹鸿侯喉猴吼后厚候乎呼忽狐胡壶湖葫糊蝴虎互户护花华哗滑化划画话桦怀淮坏欢还环缓幻唤换患荒慌皇黄煌晃灰恢挥辉徽回毁悔汇会绘惠慧昏婚浑魂混活火伙或货获祸惑霍击饥圾机肌鸡积基迹绩激及吉级即极急疾集辑籍几己挤脊计记纪忌技际剂季既济继寂寄加夹佳家嘉甲贾钾价驾架假嫁稼尖坚间肩艰兼监减剪检简碱见件建剑健舰渐践鉴键箭江姜将浆僵疆讲奖蒋匠降交郊娇浇骄胶焦礁角脚搅叫轿较教阶皆接揭街节劫杰洁结捷截竭姐解介戒届界借巾今斤金津筋仅紧锦尽劲近进晋浸禁京经茎惊晶睛精鲸井颈景警净径竞竟敬境静镜纠究九久酒旧救就舅居局菊橘举矩句巨拒具俱剧惧据距聚卷倦决绝觉掘嚼军君均菌俊峻卡开凯慨刊堪砍看康抗炕考烤靠科棵颗壳咳可渴克刻客课肯坑空孔恐控口扣枯哭苦库裤酷夸跨块快宽款狂况矿亏葵愧溃昆困扩括阔垃拉啦喇腊蜡辣来莱赖兰拦栏蓝篮览懒烂滥郎狼廊朗浪捞劳牢老乐勒雷蕾泪类累冷愣厘梨离莉犁璃黎礼李里哩理鲤力历厉立丽利励例隶粒俩连帘怜莲联廉脸练炼恋链良凉梁粮两亮辆量辽疗聊僚了料列劣烈猎裂邻林临淋磷灵玲凌铃陵羚零龄领岭令另溜刘流留硫瘤柳六龙笼隆垄拢楼漏露卢芦炉鲁陆录鹿碌路驴旅铝履律虑率绿氯滤卵乱掠略伦轮论罗萝逻螺裸洛络骆落妈麻马玛码蚂骂吗嘛埋买迈麦卖脉蛮满曼慢漫忙芒盲茫猫毛矛茅茂冒贸帽貌么没枚玫眉梅媒煤霉每美妹门闷们萌盟猛蒙孟梦弥迷谜米泌秘密蜜眠绵棉免勉面苗描秒妙庙灭民敏名明鸣命摸模膜摩磨蘑魔抹末沫陌莫漠墨默谋某母亩牡姆拇木目牧墓幕慕穆拿哪内那纳娜钠乃奶奈耐男南难囊恼脑闹呢嫩能尼泥你拟逆年念娘酿鸟尿捏您宁凝牛扭纽农浓弄奴努怒女暖挪诺哦欧偶爬帕怕拍排牌派攀盘判叛盼庞旁胖抛炮跑泡胚陪培赔佩配喷盆朋棚蓬鹏膨捧碰批披皮疲脾匹屁譬片偏篇骗漂飘瓢票拼贫频品平评凭苹屏瓶萍坡泼颇婆迫破剖扑铺葡蒲朴浦普谱七妻栖戚期欺漆齐其奇歧骑棋旗企岂启起气弃汽契砌器恰千迁牵铅谦签前钱潜浅遣欠枪腔强墙抢悄敲乔桥瞧巧切茄且窃亲侵秦琴禽勤青氢轻倾清情晴顷请庆穷丘秋蚯求球区曲驱屈躯趋取娶去趣圈全权泉拳犬劝券缺却雀确鹊裙群然燃染嚷壤让饶扰绕惹热人仁忍认任扔仍日绒荣容溶熔融柔肉如儒乳辱入软锐瑞润若弱撒洒萨塞赛三伞散桑嗓丧扫嫂色森僧杀沙纱刹砂傻啥晒山杉衫珊闪陕扇善伤商赏上尚梢烧稍少绍哨舌蛇舍设社射涉摄申伸身深神审婶肾甚渗慎升生声牲胜绳省圣盛剩尸失师诗施狮湿十什石时识实拾蚀食史使始驶士氏世市示式事侍势视试饰室是适逝释收手守首寿受兽售授瘦书抒叔枢殊疏舒输蔬熟暑署属鼠薯术束述树竖数刷耍衰摔甩帅双霜爽谁水税睡顺瞬说丝司私思斯撕死四寺似饲松耸宋送颂搜艘苏俗诉肃素速宿塑酸蒜算虽随髓岁遂碎穗孙损笋缩所索锁他它她塌塔踏胎台抬太态泰贪摊滩坛谈潭坦叹炭探碳汤唐堂塘糖躺趟涛掏逃桃陶淘萄讨套特疼腾藤梯踢啼提题蹄体替天添田甜填挑条跳贴铁厅听廷亭庭停蜓挺艇通同桐铜童统桶筒痛偷头投透突图徒涂途屠土吐兔团推腿退吞托拖脱驼妥拓唾挖哇蛙娃瓦歪外弯湾丸完玩顽挽晚碗万汪亡王网往忘旺望危威微为围违唯惟维伟伪尾纬委萎卫未位味胃谓喂慰魏温文纹闻蚊吻稳问翁窝我沃卧握乌污屋无吴吾五午伍武舞务物误悟雾夕西吸希析息牺悉惜晰稀溪锡熙嘻膝习席袭媳洗喜戏系细隙虾瞎峡狭辖霞下吓夏厦仙先纤掀鲜闲弦贤咸衔嫌显险县现线限宪陷献腺乡相香厢湘箱详祥翔享响想向巷项象像橡削消萧硝销小晓孝效校笑些歇协胁斜谐携鞋写泄泻卸屑械谢蟹心辛欣新信兴星猩刑行形型醒杏姓幸性凶兄匈胸雄熊休修羞朽秀绣袖嗅须虚需徐许序叙畜绪续蓄宣玄悬旋选穴学雪血寻巡询循训讯迅压呀鸦鸭牙芽崖哑雅亚咽烟淹延严言岩沿炎研盐颜衍掩眼演厌宴艳验焰雁燕央扬羊阳杨洋仰养氧痒样腰邀摇遥咬药要耀爷也冶野业叶页夜液一伊衣医依仪夷宜姨移遗疑乙已以矣蚁椅义亿忆艺议亦异役抑译易疫益谊逸意溢毅翼因阴音吟银引饮蚓隐印应英婴鹰迎盈营蝇赢影映硬哟拥永泳勇涌用优忧幽悠尤犹由邮油游友有又右幼诱于予余鱼娱渔愉愚与宇羽雨语玉吁育郁狱浴预域欲喻寓御裕遇愈誉豫元员园原圆袁援缘源远怨院愿曰约月岳钥悦阅跃越云匀允孕运晕韵蕴杂砸灾栽宰载再在咱暂赞脏葬遭糟早枣藻灶皂造噪燥躁则择泽责贼怎曾增赠渣扎眨炸摘宅窄债沾粘展占战站张章涨掌丈仗帐胀账障招找召兆赵照罩遮折哲者这浙针侦珍真诊枕阵振镇震争征挣睁蒸整正证郑政症之支汁芝枝知织肢脂蜘执直值职植殖止只旨址纸指趾至志制治质致智置中忠终钟肿种仲众重州舟周洲轴宙皱骤朱株珠诸猪蛛竹烛逐主煮嘱住助注贮驻柱祝著筑抓爪专砖转赚庄桩装壮状撞追准捉桌着仔兹姿资滋籽子紫字自宗综棕踪总纵走奏租足族阻组祖钻嘴最罪醉尊遵昨左作坐座做蔼隘庵鞍黯肮拗袄懊扒芭疤捌跋靶掰扳拌绊梆绑榜蚌谤磅镑苞褒雹鲍狈悖惫笨绷泵蹦匕鄙庇毙痹弊璧贬匾辫彪憋鳖瘪彬斌缤濒鬓秉禀菠舶渤跛簸哺怖埠簿睬惭沧糙厕蹭茬岔豺掺搀禅馋蝉铲猖敞钞嘲澈忱辰铛澄逞秤痴弛侈耻宠畴稠锄雏橱矗揣囱疮炊捶椿淳蠢戳绰祠赐醋簇窜篡崔摧悴粹搓撮挫瘩歹怠贷耽档叨捣祷悼蹬嘀涤缔蒂掂滇巅碘佃甸玷惦奠刁叼迭谍碟鼎董栋兜蚪逗痘睹妒镀缎兑墩盹囤钝咄哆踱垛堕舵惰跺讹娥峨蛾扼鄂愕遏噩饵贰筏矾妃匪诽吠吩氛焚忿讽敷芙拂俘袱甫斧俯脯咐缚尬丐柑竿尴秆橄赣冈肛杠羔膏糕镐疙搁蛤庚羹埂耿梗蚣躬汞苟垢沽辜雇寡卦褂乖棺逛闺瑰诡癸跪亥骇酣憨涵悍捍焊憾撼翰夯嚎皓禾烘弘弧唬沪猾徊槐宦涣焕痪凰惶蝗簧恍谎幌卉讳诲贿晦秽荤豁讥叽唧缉畸箕稽棘嫉妓祭鲫冀颊奸歼煎拣俭柬茧捡荐贱涧溅槛缰桨酱椒跤蕉侥狡绞饺矫剿缴窖酵秸睫芥诫藉襟谨荆兢靖窘揪灸玖韭臼疚拘驹鞠桔沮炬锯娟捐鹃绢眷诀倔崛爵钧骏竣咖揩楷勘坎慷糠扛亢拷铐坷苛磕蝌垦恳啃吭抠叩寇窟垮挎筷筐旷框眶盔窥魁馈坤捆廓睐婪澜揽缆榄琅榔唠姥涝烙酪垒磊肋擂棱狸漓篱吏沥俐荔栗砾痢雳镰敛粱谅晾寥嘹撩缭瞭咧琳鳞凛吝赁躏拎伶聆菱浏琉馏榴咙胧聋窿娄搂篓陋庐颅卤虏赂禄吕侣屡缕峦抡仑沦啰锣箩骡蟆馒瞒蔓莽锚卯昧媚魅氓朦檬锰咪靡眯觅缅瞄渺藐蔑皿闽悯冥铭谬馍摹茉寞沐募睦暮捺挠瑙呐馁妮匿溺腻捻撵碾聂孽拧狞柠泞钮脓疟虐懦糯殴鸥呕藕趴啪耙徘湃潘畔乓螃刨袍沛砰烹彭澎篷坯劈霹啤僻翩撇聘乒坪魄仆菩圃瀑曝柒凄祈脐崎鳍乞迄泣掐洽钳乾黔谴嵌歉呛跷锹侨憔俏峭窍翘撬怯钦芹擒寝沁卿蜻擎琼囚岖渠痊瘸冉瓤壬刃纫韧戎茸蓉榕冗揉蹂蠕汝褥蕊闰腮叁搔骚臊涩瑟鲨煞霎筛删煽擅赡裳晌捎勺奢赦呻绅沈笙甥矢屎恃拭柿嗜誓梳淑赎蜀曙恕庶墅漱蟀拴栓涮吮烁硕嗽嘶巳伺祀肆讼诵酥粟溯隋祟隧唆梭嗦琐蹋苔汰瘫痰谭檀毯棠膛倘淌烫滔誊剔屉剃涕惕恬舔迢帖彤瞳捅凸秃颓蜕褪屯豚臀驮鸵椭洼袜豌宛婉惋皖腕枉妄偎薇巍帷苇畏尉猬蔚瘟紊嗡涡蜗呜巫诬芜梧蜈侮捂鹉勿戊昔犀熄蟋徙匣侠暇馅羡镶宵潇箫霄嚣淆肖哮啸蝎邪挟懈芯锌薪馨衅腥汹锈戌墟旭恤酗婿絮轩喧癣炫绚渲靴薛勋熏旬驯汛逊殉丫押涯衙讶焉阎蜒檐砚唁谚堰殃秧鸯漾夭吆妖尧肴姚窑谣舀椰腋壹怡贻胰倚屹邑绎姻茵荫殷寅淫瘾莺樱鹦荧莹萤颖佣庸咏踊酉佑迂淤渝隅逾榆舆屿禹芋冤鸳渊猿苑粤耘陨酝哉赃凿蚤澡憎咋喳轧闸乍诈栅榨斋寨毡瞻斩盏崭辗栈绽彰樟杖昭沼肇辙蔗贞斟疹怔狰筝拯吱侄帜挚秩掷窒滞稚衷粥肘帚咒昼拄瞩蛀铸拽撰妆幢椎锥坠缀赘谆卓拙灼茁浊酌啄琢咨姊揍卒佐佘赊1234567890-=！@#￥%……&*()~:\"{}[]|\?/<>,.;' +abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        // var chars = "赊123456789";
        //var chars = "赊1234567890-=！@#￥%……&*()~:\"{}[]|\?/<>,.;' +abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX阿啊哎哀唉蛀铸拽撰妆幢椎锥坠缀赘谆卓拙灼茁浊酌啄琢咨姊揍卒佐佘YZ";
        //var chars = "123";
        // var chars = "1234567890-=！@#￥%……&*()~:\"{}[]|\?/<>,.;' +abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        // var chars = "1234567890-=！@#￥%……&*()~:\"{}[]|\?/<>,.;'";
        // var chars = "1234567";
        // var chars = "1234";

        var chars = "阿啊哎哀唉埃挨癌矮艾爱碍安氨俺岸按案暗昂凹熬傲奥澳八巴叭吧拔把坝爸罢霸白百柏摆败拜班般颁斑搬板版办半伴扮瓣邦帮膀傍棒包胞宝饱保堡报抱豹暴爆卑杯悲碑北贝备背倍被辈奔本崩逼鼻比彼笔币必毕闭辟碧蔽壁避臂边编蝙鞭扁便变遍辨辩标表别宾滨冰兵丙柄饼并病拨波玻剥播脖伯驳泊勃博搏膊薄卜补捕不布步部擦猜才材财裁采彩踩菜蔡参餐残蚕惨灿仓苍舱藏操曹槽草册侧测策层叉插查茶察差拆柴缠产阐颤昌长肠尝偿常厂场畅倡唱抄超巢朝潮吵炒车扯彻撤尘臣沉陈闯衬称趁撑成呈承诚城乘惩程橙吃池驰迟持匙尺齿斥赤翅充冲虫崇抽仇绸愁筹酬丑瞅臭出初除厨础储楚处触川穿传船喘串窗床晨创吹垂锤春纯唇醇词瓷慈辞磁雌此次刺从匆葱聪丛凑粗促催脆翠村存寸措错搭达答打大呆代带待袋逮戴丹单担胆旦但诞弹淡蛋氮当挡党荡刀导岛倒蹈到盗道稻得德的灯登等邓凳瞪低堤滴迪敌笛底抵地弟帝递第颠典点电店垫淀殿雕吊钓调掉爹跌叠蝶丁叮盯钉顶订定丢东冬懂动冻洞都斗抖陡豆督毒读独堵赌杜肚度渡端短段断锻堆队对吨敦蹲盾顿多夺朵躲俄鹅额恶饿鳄恩儿而尔耳二发乏伐罚阀法帆番翻凡烦繁反返犯泛饭范贩方坊芳防妨房肪仿访纺放飞非啡菲肥废沸肺费分纷芬坟粉份奋愤粪丰风枫封疯峰锋蜂冯逢缝凤奉佛否夫肤孵弗伏扶服浮符幅福辐蝠抚府辅腐父付妇负附复赴副傅富赋腹覆该改钙盖溉概干甘杆肝赶敢感刚岗纲缸钢港高搞稿告戈哥胳鸽割歌阁革格葛隔个各给根跟更耕工弓公功攻供宫恭巩拱共贡勾沟钩狗构购够估咕姑孤菇古谷股骨鼓固故顾瓜刮挂拐怪关观官冠馆管贯惯灌罐光广归龟规硅轨鬼柜贵桂滚棍郭锅国果裹过哈孩海害含函寒韩罕喊汉汗旱杭航毫豪好号浩耗呵喝合何和河核荷盒贺褐赫鹤黑嘿痕很狠恨哼恒横衡轰哄红宏洪虹鸿侯喉猴吼后厚候乎呼忽狐胡壶湖葫糊蝴虎互户护花华哗滑化划画话桦怀淮坏欢还环缓幻唤换患荒慌皇黄煌晃灰恢挥辉徽回毁悔汇会绘惠慧昏婚浑魂混活火伙或货获祸惑霍击饥圾机肌鸡积基迹绩激及吉级即极急疾集辑籍几己挤脊计记纪忌技际剂季既济继寂寄加夹佳家嘉甲贾钾价驾架假嫁稼尖坚间肩艰兼监减剪检简碱见件建剑健舰渐践鉴键箭江姜将浆僵疆讲奖蒋匠降交郊娇浇骄胶焦礁角脚搅叫轿较教阶皆接揭街节劫杰洁结捷截竭姐解介戒届界借巾今斤金津筋仅紧锦尽劲近进晋浸禁京经茎惊晶睛精鲸井颈景警净径竞竟敬境静镜纠究九久酒旧救就舅居局菊橘举矩句巨拒具俱剧惧据距聚卷倦决绝觉掘嚼军君均菌俊峻卡开凯慨刊堪砍看康抗炕考烤靠科棵颗壳咳可渴克刻客课肯坑空孔恐控口扣枯哭苦库裤酷夸跨块快宽款狂况矿亏葵愧溃昆困扩括阔垃拉啦喇腊蜡辣来莱赖兰拦栏蓝篮览懒烂滥郎狼廊朗浪捞劳牢老乐勒雷蕾泪类累冷愣厘梨离莉犁璃黎礼李里哩理鲤力历厉立丽利励例隶粒俩连帘怜莲联廉脸练炼恋链良凉梁粮两亮辆量辽疗聊僚了料列劣烈猎裂邻林临淋磷灵玲凌铃陵羚零龄领岭令另溜刘流留硫瘤柳六龙笼隆垄拢楼漏露卢芦炉鲁陆录鹿碌路驴旅铝履律虑率绿氯滤卵乱掠略伦轮论罗萝逻螺裸洛络骆落妈麻马玛码蚂骂吗嘛埋买迈麦卖脉蛮满曼慢漫忙芒盲茫猫毛矛茅茂冒贸帽貌么没枚玫眉梅媒煤霉每美妹门闷们萌盟猛蒙孟梦弥迷谜米泌秘密蜜眠绵棉免勉面苗描秒妙庙灭民敏名明鸣命摸模膜摩磨蘑魔抹末沫陌莫漠墨默谋某母亩牡姆拇木目牧墓幕慕穆拿哪内那纳娜钠乃奶奈耐男南难囊恼脑闹呢嫩能尼泥你拟逆年念娘酿鸟尿捏您宁凝牛扭纽农浓弄奴努怒女暖挪诺哦欧偶爬帕怕拍排牌派攀盘判叛盼庞旁胖抛炮跑泡胚陪培赔佩配喷盆朋棚蓬鹏膨捧碰批披皮疲脾匹屁譬片偏篇骗漂飘瓢票拼贫频品平评凭苹屏瓶萍坡泼颇婆迫破剖扑铺葡蒲朴浦普谱七妻栖戚期欺漆齐其奇歧骑棋旗企岂启起气弃汽契砌器恰千迁牵铅谦签前钱潜浅遣欠枪腔强墙抢悄敲乔桥瞧巧切茄且窃亲侵秦琴禽勤青氢轻倾清情晴顷请庆穷丘秋蚯求球区曲驱屈躯趋取娶去趣圈全权泉拳犬劝券缺却雀确鹊裙群然燃染嚷壤让饶扰绕惹热人仁忍认任扔仍日绒荣容溶熔融柔肉如儒乳辱入软锐瑞润若弱撒洒萨塞赛三伞散桑嗓丧扫嫂色森僧杀沙纱刹砂傻啥晒山杉衫珊闪陕扇善伤商赏上尚梢烧稍少绍哨舌蛇舍设社射涉摄申伸身深神审婶肾甚渗慎升生声牲胜绳省圣盛剩尸失师诗施狮湿十什石时识实拾蚀食史使始驶士氏世市示式事侍势视试饰室是适逝释收手守首寿受兽售授瘦书抒叔枢殊疏舒输蔬熟暑署属鼠薯术束述树竖数刷耍衰摔甩帅双霜爽谁水税睡顺瞬说丝司私思斯撕死四寺似饲松耸宋送颂搜艘苏俗诉肃素速宿塑酸蒜算虽随髓岁遂碎穗孙损笋缩所索锁他它她塌塔踏胎台抬太态泰贪摊滩坛谈潭坦叹炭探碳汤唐堂塘糖躺趟涛掏逃桃陶淘萄讨套特疼腾藤梯踢啼提题蹄体替天添田甜填挑条跳贴铁厅听廷亭庭停蜓挺艇通同桐铜童统桶筒痛偷头投透突图徒涂途屠土吐兔团推腿退吞托拖脱驼妥拓唾挖哇蛙娃瓦歪外弯湾丸完玩顽挽晚碗万汪亡王网往忘旺望危威微为围违唯惟维伟伪尾纬委萎卫未位味胃谓喂慰魏温文纹闻蚊吻稳问翁窝我沃卧握乌污屋无吴吾五午伍武舞务物误悟雾夕西吸希析息牺悉惜晰稀溪锡熙嘻膝习席袭媳洗喜戏系细隙虾瞎峡狭辖霞下吓夏厦仙先纤掀鲜闲弦贤咸衔嫌显险县现线限宪陷献腺乡相香厢湘箱详祥翔享响想向巷项象像橡削消萧硝销小晓孝效校笑些歇协胁斜谐携鞋写泄泻卸屑械谢蟹心辛欣新信兴星猩刑行形型醒杏姓幸性凶兄匈胸雄熊休修羞朽秀绣袖嗅须虚需徐许序叙畜绪续蓄宣玄悬旋选穴学雪血寻巡询循训讯迅压呀鸦鸭牙芽崖哑雅亚咽烟淹延严言岩沿炎研盐颜衍掩眼演厌宴艳验焰雁燕央扬羊阳杨洋仰养氧痒样腰邀摇遥咬药要耀爷也冶野业叶页夜液一伊衣医依仪夷宜姨移遗疑乙已以矣蚁椅义亿忆艺议亦异役抑译易疫益谊逸意溢毅翼因阴音吟银引饮蚓隐印应英婴鹰迎盈营蝇赢影映硬哟拥永泳勇涌用优忧幽悠尤犹由邮油游友有又右幼诱于予余鱼娱渔愉愚与宇羽雨语玉吁育郁狱浴预域欲喻寓御裕遇愈誉豫元员园原圆袁援缘源远怨院愿曰约月岳钥悦阅跃越云匀允孕运晕韵蕴杂砸灾栽宰载再在咱暂赞脏葬遭糟早枣藻灶皂造噪燥躁则择泽责贼怎曾增赠渣扎眨炸摘宅窄债沾粘展占战站张章涨掌丈仗帐胀账障招找召兆赵照罩遮折哲者这浙针侦珍真诊枕阵振镇震争征挣睁蒸整正证郑政症之支汁芝枝知织肢脂蜘执直值职植殖止只旨址纸指趾至志制治质致智置中忠终钟肿种仲众重州舟周洲轴宙皱骤朱株珠诸猪蛛竹烛逐主煮嘱住助注贮驻柱祝著筑抓爪专砖转赚庄桩装壮状撞追准捉桌着仔兹姿资滋籽子紫字自宗综棕踪总纵走奏租足族阻组祖钻嘴最罪醉尊遵昨左作坐座做蔼隘庵鞍黯肮拗袄懊扒芭疤捌跋靶掰扳拌绊梆绑榜蚌谤磅镑苞褒雹鲍狈悖惫笨绷泵蹦匕鄙庇毙痹弊璧贬匾辫彪憋鳖瘪彬斌缤濒鬓秉禀菠舶渤跛簸哺怖埠簿睬惭沧糙厕蹭茬岔豺掺搀禅馋蝉铲猖敞钞嘲澈忱辰铛澄逞秤痴弛侈耻宠畴稠锄雏橱矗揣囱疮炊捶椿淳蠢戳绰祠赐醋簇窜篡崔摧悴粹搓撮挫瘩歹怠贷耽档叨捣祷悼蹬嘀涤缔蒂掂滇巅碘佃甸玷惦奠刁叼迭谍碟鼎董栋兜蚪逗痘睹妒镀缎兑墩盹囤钝咄哆踱垛堕舵惰跺讹娥峨蛾扼鄂愕遏噩饵贰筏矾妃匪诽吠吩氛焚忿讽敷芙拂俘袱甫斧俯脯咐缚尬丐柑竿尴秆橄赣冈肛杠羔膏糕镐疙搁蛤庚羹埂耿梗蚣躬汞苟垢沽辜雇寡卦褂乖棺逛闺瑰诡癸跪亥骇酣憨涵悍捍焊憾撼翰夯嚎皓禾烘弘弧唬沪猾徊槐宦涣焕痪凰惶蝗簧恍谎幌卉讳诲贿晦秽荤豁讥叽唧缉畸箕稽棘嫉妓祭鲫冀颊奸歼煎拣俭柬茧捡荐贱涧溅槛缰桨酱椒跤蕉侥狡绞饺矫剿缴窖酵秸睫芥诫藉襟谨荆兢靖窘揪灸玖韭臼疚拘驹鞠桔沮炬锯娟捐鹃绢眷诀倔崛爵钧骏竣咖揩楷勘坎慷糠扛亢拷铐坷苛磕蝌垦恳啃吭抠叩寇窟垮挎筷筐旷框眶盔窥魁馈坤捆廓睐婪澜揽缆榄琅榔唠姥涝烙酪垒磊肋擂棱狸漓篱吏沥俐荔栗砾痢雳镰敛粱谅晾寥嘹撩缭瞭咧琳鳞凛吝赁躏拎伶聆菱浏琉馏榴咙胧聋窿娄搂篓陋庐颅卤虏赂禄吕侣屡缕峦抡仑沦啰锣箩骡蟆馒瞒蔓莽锚卯昧媚魅氓朦檬锰咪靡眯觅缅瞄渺藐蔑皿闽悯冥铭谬馍摹茉寞沐募睦暮捺挠瑙呐馁妮匿溺腻捻撵碾聂孽拧狞柠泞钮脓疟虐懦糯殴鸥呕藕趴啪耙徘湃潘畔乓螃刨袍沛砰烹彭澎篷坯劈霹啤僻翩撇聘乒坪魄仆菩圃瀑曝柒凄祈脐崎鳍乞迄泣掐洽钳乾黔谴嵌歉呛跷锹侨憔俏峭窍翘撬怯钦芹擒寝沁卿蜻擎琼囚岖渠痊瘸冉瓤壬刃纫韧戎茸蓉榕冗揉蹂蠕汝褥蕊闰腮叁搔骚臊涩瑟鲨煞霎筛删煽擅赡裳晌捎勺奢赦呻绅沈笙甥矢屎恃拭柿嗜誓梳淑赎蜀曙恕庶墅漱蟀拴栓涮吮烁硕嗽嘶巳伺祀肆讼诵酥粟溯隋祟隧唆梭嗦琐蹋苔汰瘫痰谭檀毯棠膛倘淌烫滔誊剔屉剃涕惕恬舔迢帖彤瞳捅凸秃颓蜕褪屯豚臀驮鸵椭洼袜豌宛婉惋皖腕枉妄偎薇巍帷苇畏尉猬蔚瘟紊嗡涡蜗呜巫诬芜梧蜈侮捂鹉勿戊昔犀熄蟋徙匣侠暇馅羡镶宵潇箫霄嚣淆肖哮啸蝎邪挟懈芯锌薪馨衅腥汹锈戌墟旭恤酗婿絮轩喧癣炫绚渲靴薛勋熏旬驯汛逊殉丫押涯衙讶焉阎蜒檐砚唁谚堰殃秧鸯漾夭吆妖尧肴姚窑谣舀椰腋壹怡贻胰倚屹邑绎姻茵荫殷寅淫瘾莺樱鹦荧莹萤颖佣庸咏踊酉佑迂淤渝隅逾榆舆屿禹芋冤鸳渊猿苑粤耘陨酝哉赃凿蚤澡憎咋喳轧闸乍诈栅榨斋寨毡瞻斩盏崭辗栈绽彰樟杖昭沼肇辙蔗贞斟疹怔狰筝拯吱侄帜挚秩掷窒滞稚衷粥肘帚咒昼拄瞩蛀铸拽撰妆幢椎锥坠缀赘谆卓拙灼茁浊酌啄琢咨姊揍卒佐佘赊1234567890-=！@#￥%……&*()~:\"{}[]|\?/<>,.;' +abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

        // var chars = "1234";



        var fontSize = 32;
        var fontWeight = 400;

        var buffer = fontSize / 8;
        var radius = fontSize / 3;

        var sdf = new TinySDF(fontSize, buffer, radius, null, null, fontWeight);





        var ctx = document.createElement("canvas").getContext("2d");



        var sdfs = {};



        var totalBins = [];






        /*! only for 3500 chinese */
        var alphaSDFImageDataWidth = 90 * sdf.size;
        var alphaSDFImageDataHeight = 40 * sdf.size;



        /*
        TODO fix: use this to generate by text

        var alphaSDFImageDataWidth = Math.ceil(Math.sqrt(a)) * sdf.size;
        var alphaSDFImageDataHeight = Math.ceil(Math.sqrt(a)) * sdf.size;
        */



        console.log(
            alphaSDFImageDataWidth, alphaSDFImageDataHeight
        );


        //for (var y = 0, i = 0; y + sdf.size <= canvas.height && i < chars.length; y += sdf.size) {
        // for (var y = 0, i = 0; y <= alphaSDFImageDataHeight && i < chars.length; y += sdf.size) {
        for (var y = 0, i = 0; y + sdf.size <= alphaSDFImageDataHeight && i < chars.length; y += sdf.size) {
            var rowBins = [];

            //for (var x = 0; x + sdf.size <= canvas.width && i < chars.length; x += sdf.size) {
            // for (var x = 0; x <= alphaSDFImageDataWidth && i < chars.length; x += sdf.size) {
            for (var x = 0; x + sdf.size <= alphaSDFImageDataWidth && i < chars.length; x += sdf.size) {
                // let bin = {
                //     x: null,
                //     y: null,
                //     w: sdf.size,
                //     h: sdf.size,
                //     data: sdf.draw(chars[i]),
                //     char: chars[i]
                // };


                // let bin = {
                //     // x,
                //     // y,
                //     // w: sdf.size,
                //     // h: sdf.size,
                //     data: sdf.draw(chars[i]),
                //     // char: chars[i]
                // };

                rowBins.push(sdf.draw(chars[i]));

                // ctx.putImageData(makeRGBAImageData(ctx, sdf.draw(chars[i]), sdf.size), x, y);


                // type fntCharData = {
                //     id: int,
                //     rect,
                //     xOffset: int,
                //     yOffset: int,
                //     xAdvance: int,
                //     /* page:number; */
                // };

                var id = chars[i].charCodeAt(0);

                var isCJK = _isCJK(id);



                var buf = fontSize / 8;
                // var buf = 0;

                // TODO width should < advance???

                // var width = fontSize + buf * 2; // glyph width
                // var height = fontSize + buf * 2; // glyph height
                var width = sdf.size;
                var height = sdf.size;

                // TODO perf: optimize for min!
                var ad = ctx.measureText(chars[i]).width * fontSize / 12 < fontSize / 2 ? fontSize / 2 : ctx.measureText(chars[i]).width * fontSize / 12;


                var by = fontSize / 2 + buf; // bearing y

                // TODO perf: remove sdfs->width,height,xOffset, yOffset

                sdfs[chars[i]] = {
                    id,
                    x: x,
                    y: y,
                    // width: fontSize,
                    // height: fontSize,
                    width,
                    height,
                    // advance: isCJK ? fontSize : ctx.measureText(chars[i]).width * 2,
                    advance: isCJK ? fontSize :
                        // ctx.measureText(chars[i]).width * fontSize/12,
                        ad,
                    // fontSize * 14 / 24,
                    xOffset: 0,
                    yOffset: by,
                };


                // alphaSDFImageData.concat(
                //     sdf.draw(chars[i])
                // );



                i++;
            }

            totalBins.push(rowBins);
        }




        var alphaSDFImageDataStep = sdf.size;

        var [alphaSDFImageData, _] =
            totalBins.reduce(([alphaSDFImageData, alphaSDFImageDataIndex],
                rowBins
            ) => {
                let alphaSDFImageDataRef = alphaSDFImageData;

                let alphaSDFImageDataIndexRef = alphaSDFImageDataIndex;

                for (let i = 0; i < sdf.size; i++) {
                    let alphaChannelStartIndex = i * sdf.size;
                    let alphaChannelEndIndex = alphaChannelStartIndex + sdf.size;


                    // let alphaSDFImageDataIndex3 = alphaSDFImageDataIndex + alphaSDFImageDataHeight * sdf.size;

                    let [
                        alphaSDFImageData, alphaSDFImageDataIndex2,
                    ] =
                        rowBins.reduce(([
                            alphaSDFImageData, alphaSDFImageDataIndex,
                        ],
                            alphaChannel
                        ) => {
                            alphaSDFImageData.set(
                                alphaChannel.subarray(
                                    alphaChannelStartIndex,
                                    alphaChannelEndIndex
                                ),
                                alphaSDFImageDataIndex,
                            );

                            return [
                                alphaSDFImageData, alphaSDFImageDataIndex + alphaSDFImageDataStep
                            ]
                        }, [alphaSDFImageDataRef, alphaSDFImageDataIndexRef]);



                    alphaSDFImageDataRef = alphaSDFImageData;

                    // alphaSDFImageDataIndexRef += alphaSDFImageDataHeight;
                    alphaSDFImageDataIndexRef += alphaSDFImageDataWidth;
                }



                // var alphaSDFImageDataIndex = alphaSDFImageDataIndex + alphaSDFImageDataWidth / sdf.size;
                alphaSDFImageDataIndex = alphaSDFImageDataIndex + alphaSDFImageDataWidth * sdf.size;


                return [
                    alphaSDFImageDataRef,
                    // alphaSDFImageDataIndexRef,
                    alphaSDFImageDataIndex
                ]
            }, [
                    new Uint8Array(
                        alphaSDFImageDataWidth * alphaSDFImageDataHeight
                    ),
                    0
                ]);

        return [sdfs, [
            alphaSDFImageData,
            alphaSDFImageDataWidth,
            alphaSDFImageDataHeight,
        ]];
    }


    function drawText(sdfs, str, size,

        canvas,
        gl,

        vertexBuffer,

        textureBuffer
    ) {
        var vertexElements = [];
        var textureElements = [];

        // var fontsize = 32;
        // var fontsize = +getEl('fontsize').value;
        // var buf = fontsize / 8;
        // var buf = 0;

        // TODO width should < advance???

        // var width = fontsize + buf * 2; // glyph width
        // var height = fontsize + buf * 2; // glyph height
        // var bx = 0; // bearing x
        // var by = fontsize / 2 + buf; // bearing y





        // var advance = fontsize; // advance


        // TODO remove scale
        // var scale = size / fontsize;
        var scale = 1;
        // var lineWidth = str.length * fontsize * scale;

        // var pen = { x: canvas.width / 2 - lineWidth / 2, y: canvas.height / 2 };
        var pen = { x: 0, y: canvas.height / 2 };


        for (var i = 0; i < str.length; i++) {

            // var advance = isCJK(str[i].charCodeAt(0)) ? fontsize : fontsize * 14 / 24;












            var posX = sdfs[str[i]].x; // pos in sprite x
            var posY = sdfs[str[i]].y; // pos in sprite y


            var width = sdfs[str[i]].width;
            var height = sdfs[str[i]].height;
            var advance = sdfs[str[i]].advance;

            var bx = sdfs[str[i]].xOffset;
            var by = sdfs[str[i]].yOffset;

            var buf = 0;


            vertexElements.push(
                pen.x + ((bx - buf) * scale), pen.y - by * scale,
                pen.x + ((bx - buf + width) * scale), pen.y - by * scale,
                pen.x + ((bx - buf) * scale), pen.y + (height - by) * scale,

                pen.x + ((bx - buf + width) * scale), pen.y - by * scale,
                pen.x + ((bx - buf) * scale), pen.y + (height - by) * scale,
                pen.x + ((bx - buf + width) * scale), pen.y + (height - by) * scale
            );

            // TODO should use sdf.size instead of width/height?

            textureElements.push(
                posX, posY,
                posX + width, posY,
                posX, posY + height,
                posX + width, posY,
                posX, posY + height,
                posX + width, posY + height
            );

            pen.x = pen.x + advance * scale;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexElements), gl.STATIC_DRAW);
        vertexBuffer.numItems = vertexElements.length / 2;

        gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureElements), gl.STATIC_DRAW);
        textureBuffer.numItems = textureElements.length / 2;
    }


    function drawGL(
        shader,
        sdfs,
        str,
        canvas, gl, pMatrix,
        texture, vertexBuffer, textureBuffer
    ) {
        gl.clearColor(0.8, 0.8, 0.8, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // var scale = +getEl('scale').value * pixelRatio / 2;
        // var buffer = +getEl('halo').value;
        // var angle = +getEl('angle').value;
        // var gamma = +getEl('gamma').value;

        var pixelRatio = window.devicePixelRatio || 1;

        var scale = 56 * pixelRatio / 2;
        // var buffer = +getEl('halo').value;
        // var angle = +getEl('angle').value;
        // var gamma = +getEl('gamma').value;






        // drawText(scale);

        drawText(
            sdfs, str, scale,

            canvas,
            gl,

            vertexBuffer,

            textureBuffer
        );

        var mvMatrix = mat4.create();
        // mat4.translate(mvMatrix, mvMatrix, [canvas2.width / 2, canvas2.height / 2, 0]);
        // mat4.rotateZ(mvMatrix, mvMatrix, angle);
        // mat4.translate(mvMatrix, mvMatrix, [-canvas2.width / 2, -canvas2.height / 2, 0]);

        var mvpMatrix = mat4.create();
        mat4.multiply(mvpMatrix, pMatrix, mvMatrix);
        gl.uniformMatrix4fv(shader.u_matrix, false, mvpMatrix);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(shader.u_texture, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.vertexAttribPointer(shader.a_pos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
        gl.vertexAttribPointer(shader.a_texcoord, 2, gl.FLOAT, false, 0, 0);



        var buffer = 0.6;
        var gamma = 2;

        // gl.uniform4fv(shader.u_color, [1, 1, 1, 1]);
        // gl.uniform1f(shader.u_buffer, buffer);
        // gl.uniform1f(shader.u_gamma, gamma * 1.4142 / scale);
        // gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.numItems);

        gl.uniform4fv(shader.u_color, [0, 0, 0, 1]);
        gl.uniform1f(shader.u_buffer, 0.75);
        gl.uniform1f(shader.u_gamma, gamma * 1.4142 / scale);
        gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.numItems);
    }



    var canvas = document.getElementById("canvas3"),
        // context = canvas.getContext("2d"),
        textarea = $("#textarea");
    // fontSelect = document.getElementById("fontSelect"),
    // sizeSelect = document.getElementById("sizeSelect"),
    // cursor = new TextCursor();


    function isTypingChinese(keyCode) {
        return keyCode === 229;
    }

    function hasChinese() {
        return textarea.val().match(/[\u4e00-\u9fa5\u3002\uff1b\uff0c\uff1a\u201c\u201d\uff08\uff09\u3001\uff1f\u300a\u300b]+/) !== null;
    }

    function insertChinese() {
        insertToLine(textarea.val());
    }

    function eraseTextarea() {
        textarea.val("");
    }

    function isBackspace(keyCode) {
        return keyCode === 8;
    }

    function insertToLine(key) {
        context.save();

        line.erase(context, imageData);
        line.insert(key);

        moveCursor(line.left + line.getWidth(context), line.bottom);

        line.draw(context);

        context.restore();
    }


    var inputEnglishChar = "";

    function prepareForTextArea() {


        $(canvas).on("mousedown", function (e) {
            e.preventDefault();

            textarea.val("");
            textarea.focus();
        });



        $(document).on("keydown", function (e) {
            // e.preventDefault();

            // textarea.val("");
            // textarea.focus();


            if (isTypingChinese(e.keyCode)) {
                console.log("is hasChinese")
                // setTextareaPos();
                // textarea.val("")

                // eraseTextarea();
                return;
            }



            // textarea.val(
            //     textarea.val() + String.fromCharCode(e.which)
            // );

            // eraseTextarea();
        });


        $(document).on("keypress", function (e) {
            // insertToLine(String.fromCharCode(e.which));


            // if (isTypingChinese(e.keyCode)) {
            //     console.log("is hasChinese")
            //     // setTextareaPos();
            //     // textarea.val("")

            //     eraseTextarea();
            //     return;
            // }

            // console.log("keypress")

            inputEnglishChar = String.fromCharCode(e.which);
        });


    }

    // var Line = (function () {
    //     var lineChars = [];

    //     return {
    //         insertChar: (char) => {

    //         },
    //         getWidth: () => {

    //         },
    //     };
    // }());

    function drawFromTextArea() {
        if (hasChinese()) {
            // insertChinese();

            console.log(
                "draw chinese:", textarea.val()
            );

            eraseTextarea();
        }
        else {

            console.log(
                "draw char:", inputEnglishChar
            );

        }



        eraseTextarea();
        inputEnglishChar = "";


    }


    return {
        main: (sdf_vertex, sdf_fragment) => {
            var canvas = document.getElementById('canvas');

            // Get the rendering context for WebGL
            var gl = canvas.getContext(
                "webgl",
                { premultipliedAlpha: false }
            );

            if (!gl) {
                console.log('Failed to get the rendering context for WebGL');
                return;
            }




            var n1 = performance.now();
            var [sdfs, [
                alphaSDFImageData,
                alphaSDFImageDataWidth,
                alphaSDFImageDataHeight
            ],
            ] = updateSDF();



            //             console.log(
            //             )

            var s =
                JSON.stringify(
                    sdfs
                )

            var n2 = performance.now();


            var sdfs =
                JSON.parse(

                    // JSON.stringify(
                    // sdfs
                    // )
                    s
                )


            var n3 = performance.now();

            console.log(n2 - n1, n3 - n2)

            console.log(
                sdfs)


            var texture = gl.createTexture();

            var vertexBuffer = gl.createBuffer();
            var textureBuffer = gl.createBuffer();







            // var sdfData = new Uint8Array(ctx2.getImageData(0, 0, canvas2.width, canvas2.height).data);


            gl.bindTexture(gl.TEXTURE_2D, texture);
            // gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, canvas2.width, canvas2.height, 0, gl.ALPHA, gl.UNSIGNED_BYTE, sdfData);



            // var sdfData = [];

            // for (let i = 0; i < 100; i++) {
            //     for (let j = 0; j < 900; j++) {
            //         // sdfData[i * 100 + j] = 1.0;
            //         sdfData[i * 900 + j] = 255;
            //     }
            // };

            // sdfData = new Uint8Array(sdfData);

            // var sdfData = new Uint8Array(alphaSDFImageData);
            var sdfData = alphaSDFImageData;


            gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, alphaSDFImageDataWidth, alphaSDFImageDataHeight, 0, gl.ALPHA, gl.UNSIGNED_BYTE, sdfData);


            // gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas2.width, canvas2.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, sdfData);


            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);



            // gl.getExtension("OES_element_index_uint");
            gl.getExtension('OES_standard_derivatives');
            // gl.getExtension('EXT_shader_texture_lod');


            var shader = createProgram(gl, sdf_vertex, sdf_fragment);




            prepareForTextArea();




            function _frame(time) {
                gl.useProgram(shader.program);
                gl.enableVertexAttribArray(shader.a_pos);
                gl.enableVertexAttribArray(shader.a_texcoord);





                gl.uniform2f(shader.u_texsize, alphaSDFImageDataWidth, alphaSDFImageDataHeight);




                var pMatrix = mat4.create();
                mat4.ortho(pMatrix, 0, gl.canvas.width, gl.canvas.height, 0, 0, -1);

                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);

                // gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

                gl.enable(gl.BLEND);
                // gl.disable(gl.BLEND);



                // gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                // gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);





                // var str = "12ab -RSTUVWX阿啊哎Y讶焉阎蜒檐砚唁谚堰殃秧鸯漾夭浊酌啄琢咨姊揍卒佐";
                var str = "12ab -RSTUVWX阿啊哎Y讶焉阎蜒檐砚唁谚堰殃秧鸯漾夭浊酌啄琢咨姊揍卒佐";
                // var str = "12ab -Y浊酌啄琢咨姊揍";
                var str = "RSTUVWX";
                var str = "129/;";
                var str = "129/,";
                var str = "卒佐佘赊阿啊哎哀唉埃挨WXYZ";
                // var str = "1234";
                // var str = "12<";
                // var str = "12ab -";



                drawGL(
                    shader,
                    sdfs,
                    str,
                    canvas, gl, pMatrix,
                    texture,

                    vertexBuffer,

                    textureBuffer
                );




                drawFromTextArea();



                requestAnimationFrame(_frame);
            };

            _frame(0);



            //             for(let $area = 0xb0; $area <= 0xf7; $area++)
            //   for(let $pos = 0xa1; $pos <= 0xfe; $pos++)
            //     fwrite($fp, pack('CC', $area, $pos));

            // var str = "";

            // for (let i = 0x4e00.toString(10); i < 0x9fff.toString(10); i++) {
            //     str += ("\u" + i.toString(16));
            // }


            // console.log(
            //     // String.fromCharCode(
            //     //     "\u4e00"
            //     // )
            //     // "\u4e00"
            //     str

            // )
        }
    }
}());

// TODO perf: generate indices buffer
