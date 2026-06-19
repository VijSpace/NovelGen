// ==================== 小说目录树组件 ====================
const NovelTree = {
  currentChapter: null,
  expandedVolumes: new Set(),

  init() {
    // 展开状态由 expandedVolumes Set 管理
  },

  render(project) {
    const container = $('#novelTree');
    if (!project || !project.volumes || project.volumes.length === 0) {
      container.innerHTML = '<div class="empty-hint">请先创建卷和章节</div>';
      return;
    }

    let html = '';
    project.volumes.forEach((vol, vi) => {
      const isExpanded = this.expandedVolumes.has(vol.id);
      html += `<div class="tree-vol">`;
      html += `<div class="tree-vol-header" data-action="toggleVol" data-vol-id="${vol.id}">`;
      html += `<span class="expand-icon${isExpanded ? ' expanded' : ''}">▶</span>`;
      html += `<span class="vol-title">第${vi + 1}卷：${escapeHtml(vol.title)}</span>`;
      html += `<span class="vol-ch-count">${vol.chapters.length}章</span>`;
      html += `<button class="tree-more-btn" data-more="volume" data-vol-id="${vol.id}" title="更多操作">⋮</button>`;
      html += `</div>`;
      html += `<div class="tree-ch-list" style="display:${isExpanded ? '' : 'none'}">`;

      vol.chapters.forEach((ch, ci) => {
        const isActive = this.currentChapter && this.currentChapter.chapterId === ch.id;
        const hasContent = ch.content && ch.content.length > 0;
        html += `<div class="tree-ch${isActive ? ' active' : ''}" data-action="selectChapter" data-vol-id="${vol.id}" data-ch-id="${ch.id}">`;
        html += `<span class="ch-icon">${hasContent ? '📄' : '📝'}</span>`;
        html += `<span class="ch-title">${escapeHtml(ch.title)}</span>`;
        html += `<span class="ch-wordcount">${ch.wordCount || 0}字</span>`;
        html += `<button class="tree-more-btn" data-more="chapter" data-vol-id="${vol.id}" data-ch-id="${ch.id}" title="更多操作">⋮</button>`;
        html += `</div>`;
      });

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
