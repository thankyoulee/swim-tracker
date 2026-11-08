export function renderPlan(day, mount, checks, onToggle) {
  mount.replaceChildren();
  
  const hero = document.createElement("section");
  hero.className = "dayhead";
  hero.innerHTML = `<div class="muted">${day.week} · ${day.shortDate}</div>
                    <h2>${day.title}</h2>
                    <b>${day.dist}</b>`;
  const totalItems = day.modules.reduce((total, module) => total + module.items.length, 0);
  let completedItems = day.modules.reduce((total, module, moduleIndex) =>
    total + module.items.filter((_, itemIndex) => checks[`${moduleIndex}-${itemIndex}`]).length, 0);
  const progress = document.createElement("div");
  progress.className = "day-progress";
  const progressLabel = document.createElement("span");
  const progressBar = document.createElement("progress");
  progressBar.max = Math.max(totalItems, 1);
  progress.append(progressLabel, progressBar);
  const updateProgress = () => {
    progressLabel.textContent = `完成度 ${completedItems}/${totalItems} (${totalItems ? Math.round(completedItems / totalItems * 100) : 0}%)`;
    progressBar.value = completedItems;
  };
  updateProgress();
  hero.append(progress);
  mount.append(hero);

  day.modules.forEach((module, moduleIndex) => {
    const section = document.createElement("section");
    section.className = "module";
    
    const isKeySet = module.type === "main" || module.is_key_set === true;
    const heading = document.createElement("h3");
    heading.textContent = module.name;
    section.append(heading);

    module.items.forEach((text, itemIndex) => {
      const row = document.createElement("div");
      row.className = "item";
      
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const key = `${moduleIndex}-${itemIndex}`;
      checkbox.checked = Boolean(checks[key]);
      checkbox.addEventListener("change", () => {
        onToggle(key, checkbox.checked);
        completedItems += checkbox.checked ? 1 : -1;
        updateProgress();
      });
      
      const textNode = document.createElement("span");
      // 完美修复：全面覆盖所有间歇格式的正则
      const regex = /(?:组间休息|轮间休息|组间大休|大休|间歇|休|Rest|休息)\s*[:：]?\s*(\d{1,2}[:.]\d{2}|\d+(?:\.\d+)?\s*(?:s|秒|分|分钟)?)/gi;
      
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        textNode.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        const btn = document.createElement("button");
        btn.className = "rest-hotspot";
        btn.textContent = match[0];
        const timeStr = match[1];
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation(); // 阻止冒泡
          document.dispatchEvent(new CustomEvent("timer:open", { detail: timeStr }));
        });
        textNode.appendChild(btn);
        lastIndex = regex.lastIndex;
      }
      textNode.appendChild(document.createTextNode(text.substring(lastIndex)));
      
      label.append(checkbox, textNode);
      row.append(label);
      section.append(row);
    });

    // 如果是主组，提供一个快捷录入按钮，直接唤起记录抽屉
    if (isKeySet) {
      const recordBtn = document.createElement("button");
      recordBtn.className = "add-split";
      recordBtn.style.marginTop = "10px";
      recordBtn.textContent = "📝 录入此组分段数据";
      recordBtn.addEventListener("click", (e) => {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("record:open", { detail: { moduleIndex } }));
      });
      section.append(recordBtn);
    }
    mount.append(section);
  });
}