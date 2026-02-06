    <script>
        const API_BASE = `http://${window.location.hostname}:3000`;
        let currentConfig = null, statusData = {}, tokens = [], countdowns = {}, expandedAccount = null;
        let autoLogInterval = null, autoHangupInterval = null, isAutoLog = false, isAutoHangup = false;
        
        function showPage(page) {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
            event.target.classList.add('active');
            if (page === 'status') loadStatusData();
            else if (page === 'bin') loadBinFiles();
            else if (page === 'logs') loadLogs();
            else if (page === 'hangup') loadHangupData();
        }
        
        const 活动类型 = { 0: '黑市周', 1: '招募周', 2: '宝箱周' };
        const 基准时间 = new Date('2025-11-21 12:00:00').getTime();
        function 计算活动周开始时间(now) {
            const d = new Date(now), w = d.getDay();
            const fri = new Date(d); fri.setDate(d.getDate() + (w < 5 ? 5 - w : w === 5 ? 0 : 12 - w));
            fri.setHours(12, 0, 0, 0);
            if (d.getTime() < fri.getTime()) fri.setDate(fri.getDate() - 7);
            return fri.getTime();
        }
        function 获取当前活动周类型() {
            const start = 计算活动周开始时间(new Date());
            const idx = Math.floor((start - 基准时间) / 604800000) % 3;
            return 活动类型[idx >= 0 ? idx : idx + 3];
        }
        function formatShortTime(s) { if (!s || s <= 0) return '-'; const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? `${h}h${m}m` : `${m}m`; }
        
        async function loadStatusData() {
            try {
                const t = Date.now();
                try { await fetch(`${API_BASE}/api/sync-accounts`, { method: 'POST' }); } catch(e) {}
                const tokensRes = await fetch(`/data/tokens.json?t=${t}`);
                if (!tokensRes.ok) throw new Error('未找到tokens.json');
                tokens = await tokensRes.json();
                try { const r = await fetch(`/data/account-status.json?t=${t}`); if (r.ok) statusData = await r.json(); } catch(e) {}
                try { const r = await fetch(`/data/task-config.json?t=${t}`); if (r.ok) currentConfig = await r.json(); } catch(e) {}
                Object.keys(countdowns).forEach(k => { if (countdowns[k]) clearInterval(countdowns[k]); }); countdowns = {};
                renderStatusTable();
                document.getElementById('totalAccounts').textContent = tokens.length;
                document.getElementById('withStatus').textContent = Object.keys(statusData).length;
            } catch (e) { document.getElementById('statusTableBody').innerHTML = `<tr><td colspan="6"><div class="no-data"><div class="no-data-icon">❌</div><div class="no-data-text">${e.message}</div></div></td></tr>`; }
        }
        
        function renderStatusTable() {
            const tbody = document.getElementById('statusTableBody');
            if (!tokens.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="no-data"><div class="no-data-icon">📭</div><div class="no-data-text">暂无账号</div></div></td></tr>`; return; }
            let html = '';
            tokens.forEach(t => {
                html += renderAccountRow(t.name, statusData[t.name]);
                html += renderDetailRow(t.name, statusData[t.name]);
                html += renderConfigRow(t.name);
            });
            tbody.innerHTML = html;
            tokens.forEach(t => { if (statusData[t.name]) startCountdown(t.name, statusData[t.name]); });
        }
