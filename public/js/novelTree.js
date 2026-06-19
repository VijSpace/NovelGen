// ==================== 小说目录树组件 ====================
const NovelTree = {
  currentChapter: null,
  expandedVolumes: new Set(),
  _dragData: null,        // 拖拽中的元素信息
  _dropIndicator: null,   // 拖拽指示器 DOM

  init() {
    this._dropIndicator = document.createElement('div');
    this._dropIndicator.className = 'tree-drop-indicator';
    this._bindDragEvents();
  },

  _bindDragEvents() {
    const tree = $('#novelTree');

    tree.addEventListener('dragstart', (e) => {
      const volHeader = e.target.closest('.tree-vol-header');
      const chItem = e.target.closest('.tree-ch');
      if (volHeader && !e.target.closest('.tree-more-btn')) {
        this._dragData = { type: 'volume', volId: volHeader.dataset.volId, el: volHeader };
      } else if (chItem && !e.target.closest('.tree-more-btn')) {
        this._dragData = { type: 'chapter', volId: chItem.dataset.volId, chId: chItem.dataset.chId, el: chItem };
      } else {
        e.preventDefault();
        return;
      }
      e.target.closest('[draggable]').classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });

    tree.addEventListener('dragend', (e) => {
      const dragEl = tree.querySelector('.dragging');
      if (dragEl) dragEl.classList.remove('dragging');
      this._hideDropIndicator();
      this._dragData = null;
    });

    tree.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this._dragData) return;
      e.dataTransfer.dropEffect = 'move';
      this._showDropIndicator(e);
    });

    tree.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!this._dragData || !App.currentProjectId) return;
      const dd = this._dragData;
      this._hideDropIndicator();

      const target = this._getDropTarget(e);
      if (!target) return;

      if (dd.type === 'volume') {
        await this._handleVolumeDrop(dd.volId, target);
      } else if (dd.type === 'chapter') {
        await this._handleChapterDrop(dd.volId, dd.chId, target);
      }
      this._dragData = null;
    });
  },

  // 找到落点：{ type: 'volume'|'chapter', volId, chId?, position: 'before'|'after'|'into' }
  _getDropTarget(e) {
    const volHeader = e.target.closest('.tree-vol-header');
    const chItem = e.target.closest('.tree-ch');
    const addVol = e.target.closest('.tree-add-vol');

    if (addVol && this._dragData.type === 'volume') {
      return { type: 'volume', volId: null, position: 'last' };
    }

    if (chItem) {
      const rect = chItem.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      return { type: 'chapter', volId: chItem.dataset.volId, chId: chItem.dataset.chId, position: e.clientY < mid ? 'before' : 'after' };
    }

    if (volHeader) {
      if (this._dragData.type === 'volume') {
        const rect = volHeader.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        return { type: 'volume', volId: volHeader.dataset.volId, position: e.clientY < mid ? 'before' : 'after' };
      }
      if (this._dragData.type === 'chapter') {
        return { type: 'volume', volId: volHeader.dataset.volId, position: 'into' };
      }
    }

    // 拖到卷列表的空区域
    const volEl = e.target.closest('.tree-vol');
    if (volEl && this._dragData.type === 'chapter') {
      const volId = volEl.querySelector('.tree-vol-header')?.dataset?.volId;
      if (volId) return { type: 'volume', volId, position: 'into' };
    }

    return null;
  },

  _showDropIndicator(e) {
    const target = this._getDropTarget(e);
    if (!target || !target.volId) {
      // 拖卷到最后
      if (target && target.position === 'last') {
        const addBtn = document.querySelector('.tree-add-vol');
        if (addBtn) {
          addBtn.parentNode.insertBefore(this._dropIndicator, addBtn);
          this._dropIndicator.style.display = 'block';
        }
      } else {
        this._hideDropIndicator();
      }
      return;
    }

    let refEl = null;
    if (target.type === 'volume') {
      const volEl = document.querySelector(`.tree-vol-header[data-vol-id="${target.volId}"]`)?.closest('.tree-vol');
      if (!volEl) { this._hideDropIndicator(); return; }
      if (target.position === 'before') refEl = volEl;
      else if (target.position === 'after') refEl = volEl.nextSibling;
      else if (target.position === 'into') {
        const chList = volEl.querySelector('.tree-ch-list');
        if (chList && chList.children.length > 0) {
          chList.insertBefore(this._dropIndicator, chList.firstChild);
        } else {
          chList?.appendChild(this._dropIndicator);
        }
        this._dropIndicator.style.display = 'block';
        return;
      }
    } else if (target.type === 'chapter') {
      const chEl = document.querySelector(`.tree-ch[data-ch-id="${target.chId}"]`);
      if (!chEl) { this._hideDropIndicator(); return; }
      refEl = target.position === 'before' ? chEl : chEl.nextSibling;
    }

    if (refEl) {
      refEl.parentNode.insertBefore(this._dropIndicator, refEl);
    } else {
      const volEl = document.querySelector(`.tree-vol-header[data-vol-id="${target.volId}"]`)?.closest('.tree-vol');
      volEl?.querySelector('.tree-ch-list')?.appendChild(this._dropIndicator);
    }
    this._dropIndicator.style.display = 'block';
  },

  _hideDropIndicator() {
    if (this._dropIndicator) {
      this._dropIndicator.style.display = 'none';
      if (this._dropIndicator.parentNode) this._dropIndicator.parentNode.removeChild(this._dropIndicator);
    }
  },

  async _handleVolumeDrop(volId, target) {
    const vols = App.currentProject.volumes;
    const orderedIds = vols.map(v => v.id);
    const fromIdx = orderedIds.indexOf(volId);
    if (fromIdx < 0) return;
    orderedIds.splice(fromIdx, 1);

    if (target.position === 'last' || !target.volId) {
      orderedIds.push(volId);
    } else {
      let toIdx = orderedIds.indexOf(target.volId);
      if (toIdx < 0) return;
      if (target.position === 'after') toIdx++;
      orderedIds.splice(toIdx, 0, volId);
    }

    App.pushHistory();
    await API.reorderVolumes(App.currentProjectId, orderedIds);
    await App.reloadProject();
    App.setSaveStatus('↕ 卷顺序已调整');
  },

  async _handleChapterDrop(fromVid, chId, target) {
    const fromVol = App.currentProject.volumes.find(v => v.id === fromVid);
    if (!fromVol) return;
    const toVid = target.volId || fromVid;

    App.pushHistory();

    if (toVid === fromVid && target.type === 'chapter') {
      // 同卷内排序
      const orderedIds = fromVol.chapters.map(c => c.id);
      const fromIdx = orderedIds.indexOf(chId);
      if (fromIdx < 0) return;
      orderedIds.splice(fromIdx, 1);
      let toIdx = orderedIds.indexOf(target.chId);
      if (toIdx < 0) return;
      if (target.position === 'after') toIdx++;
      orderedIds.splice(toIdx, 0, chId);
      await API.reorderChapters(App.currentProjectId, fromVid, orderedIds);
    } else if (toVid !== fromVid) {
      // 跨卷移动
      const toVol = App.currentProject.volumes.find(v => v.id === toVid);
      const toIdx = target.type === 'chapter'
        ? toVol.chapters.findIndex(c => c.id === target.chId) + (target.position === 'after' ? 1 : 0)
        : toVol.chapters.length;
      await API.moveChapter(App.currentProjectId, fromVid, chId, toVid, Math.max(0, toIdx));
    } else if (target.position === 'into') {
      // 拖入同卷（放到末尾）
      const orderedIds = fromVol.chapters.map(c => c.id).filter(id => id !== chId);
      orderedIds.push(chId);
      await API.reorderChapters(App.currentProjectId, fromVid, orderedIds);
    }

    await App.reloadProject();
    App.setSaveStatus('↕ 章节已移动');
  },

  render(project) {
    const container = $('#novelTree');
    if (!project) {
      container.innerHTML = '<div class="empty-hint">请先创建或选择一个项目</div>';
      return;
    }

    if (!project.volumes || project.volumes.length === 0) {
      container.innerHTML = '<div class="empty-hint">暂无卷章</div><div class="tree-add-vol" data-action="addVolume">＋ 添加新卷</div>';
      return;
    }

    let html = '';
    project.volumes.forEach((vol, vi) => {
      const isExpanded = this.expandedVolumes.has(vol.id);
      html += `<div class="tree-vol">`;
      html += `<div class="tree-vol-header" data-action="toggleVol" data-vol-id="${vol.id}" draggable="true">`;
      html += `<span class="expand-icon${isExpanded ? ' expanded' : ''}">▶</span>`;
      html += `<span class="vol-title">第${vi + 1}卷：${escapeHtml(vol.title)}</span>`;
      html += `<span class="vol-ch-count">${vol.chapters.length}章</span>`;
      html += `<button class="tree-more-btn" data-more="volume" data-vol-id="${vol.id}" title="更多操作">⋮</button>`;
      html += `</div>`;
      html += `<div class="tree-ch-list" style="display:${isExpanded ? '' : 'none'}">`;

      vol.chapters.forEach((ch, ci) => {
        const isActive = this.currentChapter && this.currentChapter.chapterId === ch.id;
        const hasContent = ch.content && ch.content.length > 0;
        html += `<div class="tree-ch${isActive ? ' active' : ''}" data-action="selectChapter" data-vol-id="${vol.id}" data-ch-id="${ch.id}" draggable="true">`;
        html += `<span class="ch-icon">${hasContent ? '📄' : '📝'}</span>`;
        html += `<span class="ch-title">${escapeHtml(ch.title)}</span>`;
        html += `<span class="ch-wordcount">${ch.wordCount || 0}字</span>`;
        html += `<button class="tree-more-btn" data-more="chapter" data-vol-id="${vol.id}" data-ch-id="${ch.id}" title="更多操作">⋮</button>`;
        html += `</div>`;
      });

      // 添加章按钮（虚线框，跟在章节列表下面）
      html += `<div class="tree-add-ch" data-action="addChapter" data-vol-id="${vol.id}">＋ 添加章</div>`;

      html += `</div></div>`;
    });

    // 添加卷按钮
    html += `<div class="tree-add-vol" data-action="addVolume">＋ 添加新卷</div>`;

    container.innerHTML = html;

    // 绑定 ⋮ 按钮
    container.querySelectorAll('.tree-more-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        App.handleMoreClick(btn, e);
      });
    });
  },

  selectChapter(projectId, volumeId, chapterId) {
    this.currentChapter = { projectId, volumeId, chapterId };
    localStorage.setItem(`novelwriter_last_chapter_${projectId}`, chapterId);
    App.loadChapterContent(projectId, volumeId, chapterId);
  }
};
