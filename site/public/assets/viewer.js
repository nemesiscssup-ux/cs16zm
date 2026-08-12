"use strict";
/*
 * Просмотр моделей: картинка на карточке, живая модель — в окне поверх страницы.
 *
 * ⚠️ ПОЧЕМУ НЕ ПО ТРЁХМЕРНОМУ ОКОШКУ НА КАЖДУЮ КАРТОЧКУ, КАК БЫЛО.
 * Каждому такому окошку нужен свой контекст WebGL, а браузер держит их около
 * шестнадцати. На странице привилегий их выходило за двадцать: пока листаешь
 * вниз, у самых первых карточек контекст отбирают, и вместо модели остаётся
 * белый квадрат — ровно это владелец и увидел, вернувшись наверх.
 *
 * Поэтому теперь: на карточке — заранее нарисованная картинка (её делает
 * site/tools/build-models.mjs), а живой просмотр ОДИН на всю страницу и
 * открывается по щелчку. Контекст ровно один, кончиться ему не с чего.
 *
 * Заодно страница стала легче: раньше при прокрутке подтягивалось до пяти
 * мегабайт геометрии, теперь — только то, что открыли.
 *
 * Окно двухколоночное: слева живая модель, справа — клон <template> со
 * страницы (на него указывает data-panel). Про сам этот кусок просмотрщик не
 * знает ничего: он его только вставляет, а щелчки по кнопкам внутри всплывают
 * до document, где их ловит страница. Поэтому здесь нет и не должно появиться
 * ни цен, ни уровней, ни магазина. Каждая из колонок необязательна: без модели
 * прячется левая, без шаблона — правая.
 *
 * Система координат у GoldSrc своя: X вперёд, Y влево, Z вверх. Поэтому
 * вращаем вокруг Z, а не вокруг Y, как принято почти везде.
 */

(function () {

  const BASE = "models/";

  /*
   * Версию берём из адреса самого просмотрщика (<script src="viewer.js?v=5">) и
   * приписываем ко всем моделям.
   *
   * ⚠️ БЕЗ ЭТОГО ПРАВКИ МОДЕЛЕЙ НЕ ДОХОДЯТ ДО ЛЮДЕЙ. Хостинг отдаёт картинки с
   * Cache-Control: max-age=86400, а перед ним стоит DDoS-Guard со своим кэшем:
   * по тому же адресу он сутки раздаёт старую копию, и обновление страницы с
   * Ctrl+F5 тут не помогает — оно сбрасывает кэш браузера, а не защиты.
   */
  const V = (function () {
    const src = document.currentScript && document.currentScript.src;
    const m = src && src.match(/[?&]v=([^&]+)/);
    return m ? "?v=" + m[1] : "";
  })();

  // ── матрицы ───────────────────────────────────────────────────────────────

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const d = near - far;
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / d, -1,
      0, 0, (2 * far * near) / d, 0,
    ]);
  }

  function lookAt(eye, center, up) {
    const z = norm([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
    ]);
  }

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  const translation = (x, y, z) =>
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

  // ── шейдеры ───────────────────────────────────────────────────────────────
  //
  // Свет намеренно простой: одна направленная лампа плюс мягкая подсветка,
  // чтобы модель не проваливалась в чёрное там, куда лампа не достаёт. Модели
  // CS 1.6 рисовались под плоское освещение движка, и всякая попытка осветить
  // их «красиво» делает из них пластик.

  const VERT = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    varying vec3 vNormal;
    varying vec2 vUV;
    void main() {
      vNormal = mat3(uModel) * aNormal;
      vUV = aUV;
      gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
    }`;

  const FRAG = `
    precision mediump float;
    uniform sampler2D uTex;
    varying vec3 vNormal;
    varying vec2 vUV;
    void main() {
      // Нормаль разворачиваем у изнаночных треугольников: модели GoldSrc
      // собирали разные люди, и обход вершин у части из них обратный.
      // Односторонний материал показал бы такую модель дырявой.
      vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
      vec3 light = normalize(vec3(-0.4, -0.8, 0.6));
      float lambert = max(dot(n, light), 0.0);
      float fill = 0.45 + 0.25 * max(dot(n, vec3(0.0, 0.0, -1.0)), 0.0);
      vec4 tex = texture2D(uTex, vUV);
      if (tex.a < 0.5) discard;
      gl_FragColor = vec4(tex.rgb * (fill + 0.75 * lambert), 1.0);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // ── единственная сцена ────────────────────────────────────────────────────

  const Stage = {
    gl: null, canvas: null, program: null, loc: null,
    buffers: null, meta: null, textures: [],
    yaw: Math.PI * 0.75, pitch: 0.2, dist: 100, spin: true,
    raf: 0, token: 0,

    init(canvas) {
      if (this.gl) return true;
      const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
      if (!gl) return false;
      this.gl = gl;
      this.canvas = canvas;

      const p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.program = p;
      this.loc = {
        pos: gl.getAttribLocation(p, "aPos"),
        normal: gl.getAttribLocation(p, "aNormal"),
        uv: gl.getAttribLocation(p, "aUV"),
        proj: gl.getUniformLocation(p, "uProj"),
        view: gl.getUniformLocation(p, "uView"),
        model: gl.getUniformLocation(p, "uModel"),
        tex: gl.getUniformLocation(p, "uTex"),
      };

      // Контекст всё же могут отобрать — например когда вкладку свернули
      // надолго. Тогда просто собираем всё заново при следующем показе.
      canvas.addEventListener("webglcontextlost", e => {
        e.preventDefault();
        this.gl = null;
        this.buffers = null;
      });
      return true;
    },

    flatTexture(rgba) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
      return t;
    },

    loadTexture(url) {
      const gl = this.gl;
      const t = this.flatTexture([200, 200, 200, 255]);
      const img = new Image();
      img.onload = () => {
        if (!this.gl) return;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        // Размеры текстур в моделях бывают не степенью двойки — тогда
        // повторение и мипмапы браузер запрещает, и текстура выходит чёрной.
        const pow2 = (img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0;
        if (pow2) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        this.draw();
      };
      img.src = BASE + url + V;
      return t;
    },

    async load(id) {
      const mine = ++this.token;          // чтобы быстрые переключения не гонялись
      const gl = this.gl;

      const m = await fetch(BASE + id + ".json" + V).then(r => r.json());
      const raw = await fetch(BASE + id + ".bin" + V).then(r => r.arrayBuffer());
      if (mine !== this.token || !this.gl) return;

      if (m.indexBytes === 4 && !gl.getExtension("OES_element_index_uint")) {
        throw new Error("модель слишком подробна для этого браузера");
      }

      const verts = new Float32Array(raw, 0, m.vertexCount * 8);
      const idx = m.indexBytes === 4
        ? new Uint32Array(raw, m.vertexBytes, m.indexCount)
        : new Uint16Array(raw, m.vertexBytes, m.indexCount);

      if (this.buffers) {
        gl.deleteBuffer(this.buffers.vb);
        gl.deleteBuffer(this.buffers.ib);
        this.textures.forEach(t => gl.deleteTexture(t));
      }

      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

      this.meta = m;
      this.buffers = { vb, ib, type: m.indexBytes === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
      this.textures = m.parts.map(p => (p.texture ? this.loadTexture(p.texture) : this.flatTexture([200, 200, 200, 255])));

      const span = Math.max(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]);
      this.dist = span * 1.9;
      this.yaw = Math.PI * 0.75;
      this.pitch = 0.2;
      this.draw();
    },

    resize() {
      const box = this.canvas.parentNode;
      const w = Math.max(1, box.clientWidth);
      const h = Math.max(1, box.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = (w * dpr) | 0;
      this.canvas.height = (h * dpr) | 0;
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";
    },

    draw() {
      const gl = this.gl;
      if (!gl || !this.buffers || !this.meta) return;
      this.resize();

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      // Отсечение изнанки выключено намеренно: см. шейдер.
      gl.disable(gl.CULL_FACE);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);

      const m = this.meta;
      const cx = (m.min[0] + m.max[0]) / 2;
      const cy = (m.min[1] + m.max[1]) / 2;
      const cz = (m.min[2] + m.max[2]) / 2;

      // Z — это верх: модель стоит на ногах, а не лежит набок.
      const eye = [
        Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
        Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
        Math.sin(this.pitch) * this.dist,
      ];
      gl.uniformMatrix4fv(this.loc.proj, false,
        perspective(Math.PI / 5, this.canvas.width / this.canvas.height, 1, 6000));
      gl.uniformMatrix4fv(this.loc.view, false, lookAt(eye, [0, 0, 0], [0, 0, 1]));
      gl.uniformMatrix4fv(this.loc.model, false, translation(-cx, -cy, -cz));

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vb);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.ib);
      const stride = 32;
      gl.enableVertexAttribArray(this.loc.pos);
      gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.loc.normal);
      gl.vertexAttribPointer(this.loc.normal, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(this.loc.uv);
      gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, stride, 24);

      const size = this.buffers.type === gl.UNSIGNED_INT ? 4 : 2;
      m.parts.forEach((part, i) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
        gl.uniform1i(this.loc.tex, 0);
        gl.drawElements(gl.TRIANGLES, part.count, this.buffers.type, part.start * size);
      });
    },

    tick() {
      if (this.spin) {
        this.yaw += 0.006;
        this.draw();
      }
      this.raf = requestAnimationFrame(() => this.tick());
    },

    start() { if (!this.raf) this.tick(); },
    stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } },
  };

  // ── окно просмотра ────────────────────────────────────────────────────────

  const Modal = {
    root: null, cols: null, left: null, side: null,
    stage: null, title: null, desc: null, picks: null, note: null,

    build() {
      if (this.root) return;
      const root = document.createElement("div");
      root.className = "mv";
      root.hidden = true;
      root.innerHTML =
        '<div class="mv-back"></div>' +
        '<div class="mv-box" role="dialog" aria-modal="true">' +
          '<button class="mv-close" type="button" aria-label="Закрыть">×</button>' +
          '<div class="mv-title"></div>' +
          '<div class="mv-cols">' +
            '<div class="mv-left">' +
              '<div class="mv-stage"><canvas></canvas><div class="mv-note"></div></div>' +
              '<div class="mv-desc"></div>' +
              '<div class="mv-picks"></div>' +
            '</div>' +
            '<div class="mv-side"></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(root);

      this.root = root;
      this.cols = root.querySelector(".mv-cols");
      this.left = root.querySelector(".mv-left");
      this.side = root.querySelector(".mv-side");
      this.stage = root.querySelector(".mv-stage");
      this.title = root.querySelector(".mv-title");
      this.desc = root.querySelector(".mv-desc");
      this.picks = root.querySelector(".mv-picks");
      this.note = root.querySelector(".mv-note");

      root.querySelector(".mv-back").addEventListener("click", () => this.close());
      root.querySelector(".mv-close").addEventListener("click", () => this.close());
      // Любой элемент с data-mv-close закрывает окно — этим пользуются кнопки
      // из правой колонки («Выбрать этот уровень»). Всплытие мы намеренно не
      // останавливаем: тот же щелчок должен дойти до document, где страница
      // сама решит, что он значит. Просмотрщику знать это не положено.
      root.addEventListener("click", e => {
        if (e.target.closest && e.target.closest("[data-mv-close]")) this.close();
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !root.hidden) this.close();
      });

      this.bindDrag();
      window.addEventListener("resize", () => Stage.draw());
    },

    bindDrag() {
      const el = this.stage;
      let dragging = false, lastX = 0, lastY = 0;

      const grab = e => {
        dragging = true;
        Stage.spin = false;
        const p = e.touches ? e.touches[0] : e;
        lastX = p.clientX; lastY = p.clientY;
        el.classList.add("grabbing");
      };
      const move = e => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        Stage.yaw -= (p.clientX - lastX) * 0.01;
        Stage.pitch = Math.max(-1.2, Math.min(1.2, Stage.pitch + (p.clientY - lastY) * 0.01));
        lastX = p.clientX; lastY = p.clientY;
        if (e.cancelable) e.preventDefault();
        Stage.draw();
      };
      const drop = () => { dragging = false; el.classList.remove("grabbing"); };

      el.addEventListener("mousedown", grab);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", drop);
      el.addEventListener("touchstart", grab, { passive: true });
      el.addEventListener("touchmove", move, { passive: false });
      el.addEventListener("touchend", drop);
      el.addEventListener("wheel", e => {
        e.preventDefault();
        Stage.dist = Math.max(8, Math.min(900, Stage.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
        Stage.draw();
      }, { passive: false });
    },

    /*
     * Правая колонка — клон содержимого <template id="…"> со страницы.
     *
     * ⚠️ Клонируем при КАЖДОМ открытии, а не один раз при сборке окна. Внутри
     * клона живут кнопки, и страница вправе с ним что угодно делать; вставь мы
     * сам узел шаблона или клон «навсегда» — второе открытие показало бы то,
     * что осталось после первого. Клон живёт ровно один показ.
     *
     * Возвращает, вышло ли из этого хоть что-то: пустой или отсутствующий
     * шаблон — это окно без правой колонки.
     */
    fillSide(id) {
      this.side.innerHTML = "";
      const tpl = id ? document.getElementById(id) : null;
      if (tpl && tpl.content) this.side.appendChild(tpl.content.cloneNode(true));
      const has = !!this.side.firstChild;
      this.side.hidden = !has;
      return has;
    },

    open(card) {
      this.build();
      const id = card.dataset.model || "";
      const side = this.fillSide(card.dataset.panel || "");

      // Класс solo — когда второй колонки просто нет, хоть левой, хоть правой.
      this.left.hidden = !id;
      this.cols.classList.toggle("solo", !id || !side);

      // Заголовок ставим здесь, а не только в show(): у окна без модели
      // show() не позовётся вовсе, а название ему всё равно нужно.
      this.title.textContent = card.dataset.title || "";
      this.root.hidden = false;
      document.body.classList.add("mv-open");

      /*
       * ⚠️ Без data-model сцену не поднимаем ВОВСЕ. Stage.init() завёл бы
       * контекст WebGL на странице, где ни одной модели может не быть (у
       * админки её нет), — и отнял бы его у чужой вкладки просто так.
       */
      if (!id) return;

      const items = this.itemsOf(card);
      const canvas = this.stage.querySelector("canvas");
      let ok = true;
      try {
        ok = Stage.init(canvas);
      } catch (err) {
        ok = false;
      }
      if (!ok) {
        this.note.textContent = "браузер не умеет WebGL — модель не показать";
        return;
      }

      this.drawPicks(items, 0);
      this.show(items[0]);
      Stage.spin = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      Stage.start();
    },

    /** Что можно посмотреть из этой карточки: сама модель и, если есть, ножи. */
    itemsOf(card) {
      const first = {
        id: card.dataset.model,
        name: card.dataset.title || "",
        desc: card.dataset.desc || "",
      };
      let extra = [];
      if (card.dataset.extra) {
        try { extra = JSON.parse(card.dataset.extra); } catch (e) { extra = []; }
      }
      return [first].concat(extra);
    },

    drawPicks(items, active) {
      if (items.length < 2) { this.picks.innerHTML = ""; this.picks.hidden = true; return; }
      this.picks.hidden = false;
      this.picks.innerHTML = items.map((it, i) =>
        '<button type="button" class="mv-pick' + (i === active ? " on" : "") + '" data-i="' + i + '">' +
          '<img src="' + BASE + it.id + ".png" + V + '" alt="" loading="lazy">' +
          '<span>' + esc(it.name) + '</span>' +
        '</button>').join("");
      this.picks.querySelectorAll(".mv-pick").forEach(b => {
        b.addEventListener("click", () => {
          const i = Number(b.dataset.i);
          this.picks.querySelectorAll(".mv-pick").forEach(x => x.classList.remove("on"));
          b.classList.add("on");
          this.show(items[i]);
        });
      });
    },

    show(item) {
      this.title.textContent = item.name || "";
      this.desc.textContent = item.desc || "";
      this.note.textContent = "загружаю…";
      Stage.load(item.id)
        .then(() => { this.note.textContent = ""; })
        .catch(err => { this.note.textContent = String(err.message || "модель не загрузилась"); });
    },

    close() {
      if (!this.root || this.root.hidden) return;
      this.root.hidden = true;
      document.body.classList.remove("mv-open");
      Stage.stop();
    },
  };

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ── запуск ────────────────────────────────────────────────────────────────

  function boot() {
    // Окно открывает и то, у чего есть модель, и то, у чего есть только
    // правая колонка (карточка админки): смотреть там нечего, читать — есть.
    const cards = [].slice.call(document.querySelectorAll("[data-model], [data-panel]"));
    if (!cards.length) return;

    cards.forEach(card => {
      const open = e => {
        // Карточка уровня — это <label> с переключателем внутри, а ссылка на
        // главной ведёт на другую страницу. И то и другое надо остановить,
        // иначе щелчок по модели уводит со страницы вместо показа.
        e.preventDefault();
        e.stopPropagation();
        Modal.open(card);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") open(e);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
