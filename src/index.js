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



    function updateSDF(canvas, ctx) {
        var chars = 'abc123- 泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶玉镇雪午练迫爷篇肉嘴馆遍凡础洞卷坦牛宁纸诸训私庄祖丝翻暴森塔默握戏隐熟骨访弱蒙歌店鬼软典欲萨伙遭盘爸扩盖弄雄稳忘亿刺拥徒姆杨齐赛趣曲刀床迎冰虚玩析窗醒妻透购替塞努休虎扬途侵刑绿兄迅套贸毕唯谷轮库迹尤竞街促延震弃甲伟麻川申缓潜闪售灯针哲络抵朱埃抱鼓植纯夏忍页杰筑折郑贝尊吴秀混臣雅振染盛怒舞圆搞狂措姓残秋培迷诚宽宇猛摆梅毁伸摩盟末乃悲拍丁赵硬麦蒋操耶阻订彩抽赞魔纷沿喊违妹浪汇币丰蓝殊献桌啦瓦莱援译夺汽烧距裁偏符勇触课敬哭懂墙袭召罚侠厅拜巧侧韩冒债曼融惯享戴童犹乘挂奖绍厚纵障讯涉彻刊丈爆乌役描洗玛患妙镜唱烦签仙彼弗症仿倾牌陷鸟轰咱菜闭奋庆撤泪茶疾缘播朗杜奶季丹狗尾仪偷奔珠虫驻孔宜艾桥淡翼恨繁寒伴叹旦愈潮粮缩罢聚径恰挑袋灰捕徐珍幕映裂泰隔启尖忠累炎暂估泛荒偿横拒瑞忆孤鼻闹羊呆厉衡胞零穷舍码赫婆魂灾洪腿胆津俗辩胸晓劲贫仁偶辑邦恢赖圈摸仰润堆碰艇稍迟辆废净凶署壁御奉旋冬矿抬蛋晨伏吹鸡倍糊秦盾杯租骑乏隆诊奴摄丧污渡旗甘耐凭扎抢绪粗肩梁幻菲皆碎宙叔岩荡综爬荷悉蒂返井壮薄悄扫敏碍殖详迪矛霍允幅撒剩凯颗骂赏液番箱贴漫酸郎腰舒眉忧浮辛恋餐吓挺励辞艘键伍峰尺昨黎辈贯侦滑券崇扰宪绕趋慈乔阅汗枝拖墨胁插箭腊粉泥氏彭拔骗凤慧媒佩愤扑龄驱惜豪掩兼跃尸肃帕驶堡届欣惠册储飘桑闲惨洁踪勃宾频仇磨递邪撞拟滚奏巡颜剂绩贡疯坡瞧截燃焦殿伪柳锁逼颇昏劝呈搜勤戒驾漂饮曹朵仔柔俩孟腐幼践籍牧凉牲佳娜浓芳稿竹腹跌逻垂遵脉貌柏狱猜怜惑陶兽帐饰贷昌叙躺钢沟寄扶铺邓寿惧询汤盗肥尝匆辉奈扣廷澳嘛董迁凝慰厌脏腾幽怨鞋丢埋泉涌辖躲晋紫艰魏吾慌祝邮吐狠鉴曰械咬邻赤挤弯椅陪割揭韦悟聪雾锋梯猫祥阔誉筹丛牵鸣沈阁穆屈旨袖猎臂蛇贺柱抛鼠瑟戈牢逊迈欺吨琴衰瓶恼燕仲诱狼池疼卢仗冠粒遥吕玄尘冯抚浅敦纠钻晶岂峡苍喷耗凌敲菌赔涂粹扁亏寂煤熊恭湿循暖糖赋抑秩帽哀宿踏烂袁侯抖夹昆肝擦猪炼恒慎搬纽纹玻渔磁铜齿跨押怖漠疲叛遣兹祭醉拳弥斜档稀捷肤疫肿豆削岗晃吞宏癌肚隶履涨耀扭坛拨沃绘伐堪仆郭牺歼墓雇廉契拼惩捉覆刷劫嫌瓜歇雕闷乳串娃缴唤赢莲霸桃妥瘦搭赴岳嘉舱俊址庞耕锐缝悔邀玲惟斥宅添挖呵讼氧浩羽斤酷掠妖祸侍乙妨贪挣汪尿莉悬唇翰仓轨枚盐览傅帅庙芬屏寺胖璃愚滴疏萧姿颤丑劣柯寸扔盯辱匹俱辨饿蜂哦腔郁溃谨糟葛苗肠忌溜鸿爵鹏鹰笼丘桂滋聊挡纲肌茨壳痕碗穴膀卓贤卧膜毅锦欠哩函';




        var fontSize = 32;
        var fontWeight = 400;

        var buffer = fontSize / 8;
        var radius = fontSize / 3;

        var sdf = new TinySDF(fontSize, buffer, radius, null, null, fontWeight);





        var ctx = document.createElement("canvas").getContext("2d");



        var sdfs = {};



        var totalBins = [];



        for (var y = 0, i = 0; y + sdf.size <= canvas.height && i < chars.length; y += sdf.size) {
            var rowBins = [];

            for (var x = 0; x + sdf.size <= canvas.width && i < chars.length; x += sdf.size) {
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

                var width = fontSize + buf * 2; // glyph width
                var height = fontSize + buf * 2; // glyph height

                // TODO perf: optimize for min!
                var ad = ctx.measureText(chars[i]).width * fontSize / 12 < fontSize / 2 ? fontSize / 2 : ctx.measureText(chars[i]).width * fontSize / 12;


                var by = fontSize / 2 + buf; // bearing y

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


        var alphaSDFImageDataWidth = Math.floor(canvas.width / sdf.size) * sdf.size;
        var alphaSDFImageDataHeight = Math.floor(canvas.height / sdf.size) * sdf.size;



        var alphaSDFImageDataStep = sdf.size;

        var [alphaSDFImageData, _] =
            totalBins.reduce(([alphaSDFImageData, alphaSDFImageDataIndex],
                rowBins
            ) => {
                var alphaSDFImageDataRef = alphaSDFImageData;

                var alphaSDFImageDataIndexRef = alphaSDFImageDataIndex;

                for (let i = 0; i < sdf.size; i++) {
                    var alphaChannelStartIndex = i * sdf.size;
                    var alphaChannelEndIndex = alphaChannelStartIndex + sdf.size;

                    var [
                        alphaSDFImageData, alphaSDFImageDataIndex,
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

                    alphaSDFImageDataIndexRef = alphaSDFImageDataIndex;
                }



                return [
                    alphaSDFImageDataRef,
                    alphaSDFImageDataIndexRef,
                ]
            }, [
                    new Uint8Array(
                        alphaSDFImageDataWidth * alphaSDFImageDataHeight
                    ),
                    0
                ]);

        // var { w, h } = potpack(bins);

        // bins.forEach(({
        //     x, y, w, h, data, char
        // }) => {
        //     sdfs[char] = { x: x, y: y };
        // });



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


            var canvas2 = document.getElementById("canvas2");

            var ctx2 = canvas2.getContext("2d");


            var n1 = performance.now();
            var [sdfs, [
                alphaSDFImageData,
                alphaSDFImageDataWidth,
                alphaSDFImageDataHeight
            ],
            ] = updateSDF(canvas2, ctx2);

            var n2 = performance.now();

            console.log(n2 - n1)



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





                var str = "12ab -泽材灭逐莫笔亡鲜词圣择寻厂睡博";



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
        }
    }
}());

// TODO perf: generate indices buffer