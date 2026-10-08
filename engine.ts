import { Client, APIGatewayBotInfo } from '@discordjs/core';
import { RequestInit } from 'undici';
import { REST, DefaultRestOptions, ResponseLike } from '@discordjs/rest';
import { WebSocketManager, WebSocketShard } from '@discordjs/ws';
import { GatewaySendPayload, GatewayOpcodes } from 'discord-api-types/v10';
import { randomUUID } from 'node:crypto';

export type Snowflake = string;

export enum TaskType {
    WATCH_VIDEO = 'WATCH_VIDEO',
    WATCH_VIDEO_ON_MOBILE = 'WATCH_VIDEO_ON_MOBILE',
    WATCH_STREAM = 'WATCH_STREAM',
    PLAY_ON_DESKTOP = 'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP = 'STREAM_ON_DESKTOP',
    PLAY_ON_XBOX = 'PLAY_ON_XBOX',
    PLAY_ON_PLAYSTATION = 'PLAY_ON_PLAYSTATION',
    PLAY_ON_NINTENDO = 'PLAY_ON_NINTENDO',
    PLAY_ON_MOBILE = 'PLAY_ON_MOBILE',
    PLAY_ACTIVITY = 'PLAY_ACTIVITY',
    PLAY_SOCIAL_GAME = 'PLAY_SOCIAL_GAME',
    JOIN_COMMUNITY = 'JOIN_COMMUNITY',
    SHARE_CONTENT = 'SHARE_CONTENT',
    FOLLOW_SOCIAL = 'FOLLOW_SOCIAL',
    COMPLETE_SURVEY = 'COMPLETE_SURVEY',
    MAKE_PURCHASE = 'MAKE_PURCHASE',
    REDEEM_CODE = 'REDEEM_CODE',
}

export class Quest {
    private raw: any;
    private constructor(raw: any) { this.raw = raw; }
    static from(raw: any): Quest { return new Quest(raw); }

    get id() { return this.raw.id; }
    get config() { return this.raw.config; }
    get userStatus() { return this.raw.user_status; }
    get preview() { return this.raw.preview; }

    isExpired(now: Date = new Date()): boolean {
        return now.getTime() > new Date(this.raw.config.expires_at).getTime();
    }

    isCompleted(): boolean { return Boolean(this.userStatus?.completed_at); }
    isEnrolled(): boolean { return Boolean(this.userStatus?.enrolled_at); }
    isClaimed(): boolean { return Boolean(this.userStatus?.claimed_at); }

    refreshStatus(status: any) { this.raw.user_status = status; }

    detectTaskType(): TaskType | null {
        const tasks = this.config.task_config_v2?.tasks ?? this.config.task_config?.tasks;
        if (!tasks) return null;
        const priority = [
            TaskType.PLAY_ON_DESKTOP, TaskType.PLAY_ON_XBOX, TaskType.PLAY_ON_PLAYSTATION,
            TaskType.PLAY_ON_NINTENDO, TaskType.PLAY_ON_MOBILE, TaskType.PLAY_SOCIAL_GAME,
            TaskType.PLAY_ACTIVITY, TaskType.STREAM_ON_DESKTOP, TaskType.WATCH_STREAM,
            TaskType.WATCH_VIDEO, TaskType.WATCH_VIDEO_ON_MOBILE, TaskType.FOLLOW_SOCIAL,
            TaskType.SHARE_CONTENT, TaskType.JOIN_COMMUNITY, TaskType.COMPLETE_SURVEY,
            TaskType.REDEEM_CODE, TaskType.MAKE_PURCHASE,
        ];
        return priority.find((t) => tasks[t] != null) ?? null;
    }

    getTarget(): number {
        const taskType = this.detectTaskType();
        if (!taskType) return 900;
        const tasks = this.config.task_config_v2?.tasks ?? this.config.task_config?.tasks;
        return tasks?.[taskType]?.target ?? 900;
    }

    getProgress(): number {
        const taskType = this.detectTaskType();
        if (!taskType) return 0;
        return this.userStatus?.progress?.[taskType]?.value ?? 0;
    }

    getRemaining(): number { return Math.max(0, this.getTarget() - this.getProgress()); }

    getRewardLabel(): string {
        const rewards = this.config.rewards_config?.rewards;
        if (!rewards?.length) return 'Unknown';
        if (rewards[0].orb_quantity) return `${rewards[0].orb_quantity} Orbs`;
        return rewards[0].messages?.name ?? 'Unknown';
    }

    get name(): string { return this.config.messages.quest_name?.trim() || this.id; }
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

const CLIENT_PROPS = {
    os: 'Windows', browser: 'Discord Client', release_channel: 'stable',
    client_version: '1.0.9215', os_version: '10.0.19045', os_arch: 'x64',
    app_arch: 'x64', system_locale: 'en-US', has_client_mods: false,
    client_launch_id: randomUUID(), browser_user_agent: USER_AGENT,
    browser_version: '37.6.0', os_sdk_version: '19045', client_build_number: 471091,
    native_build_number: 72186, client_event_source: null, launch_signature: randomUUID(),
    client_heartbeat_session_id: randomUUID(), client_app_state: 'focused',
};

// Xử lý request chuẩn, tự động lọc bỏ tiền tố Bot và xử lý Rate Limit (429)
async function patchedFetch(url: string, init: RequestInit): Promise<ResponseLike> {
    if (init.headers) {
        const h = new Headers(init.headers as any);
        if (h.has('User-Agent')) h.set('User-Agent', USER_AGENT);
        if (h.has('Authorization')) {
            let token = h.get('Authorization') || '';
            token = token.replace(/^Bot\s+/i, '').trim(); // Tránh lỗi 401 Unauthorized do dính chữ Bot
            h.set('Authorization', token);
        }
        h.append('accept-language', 'vi');
        h.append('origin', 'https://discord.com');
        h.append('referer', 'https://discord.com/channels/@me');
        init.headers = h;
    }

    let res = await DefaultRestOptions.makeRequest(url, init);

    // Tự động chờ và retry khi bị Discord giới hạn tốc độ (Rate Limit 429)
    if (res.statusCode === 429) {
        try {
            const bodyText = await res.body.text();
            const data = JSON.parse(bodyText);
            const retryAfter = (data.retry_after || 5) * 1000;
            console.log(`[Rate Limited] Đang bị chặn, tự động chờ ${data.retry_after} giây...`);
            await new Promise((r) => setTimeout(r, retryAfter));
            return DefaultRestOptions.makeRequest(url, init);
        } catch {
            await new Promise((r) => setTimeout(r, 5000));
            return DefaultRestOptions.makeRequest(url, init);
        }
    }

    return res;
}

export class HieuTool extends Client {
    public quests: QuestStore | null = null;
    public ws: WebSocketManager;

    constructor(token: string) {
        const rest = new REST({ version: '10', makeRequest: patchedFetch }).setToken(token);
        const gw = new WebSocketManager({ token, intents: 0, rest });
        gw.fetchGatewayInformation = (): Promise<APIGatewayBotInfo> =>
            Promise.resolve({
                url: 'wss://gateway.discord.gg',
                shards: 1,
                session_start_limit: { total: 1000, remaining: 1000, reset_after: 14400000, max_concurrency: 1 },
            });
        super({ rest, gateway: gw });
        this.ws = gw;
    }

    start() { return this.ws.connect(); }

    async loadQuests(): Promise<QuestStore> {
        const res = (await this.rest.get('/quests/@me')) as any;
        this.quests = new QuestStore(this, res.quests.map((q: any) => Quest.from(q)));
        return this.quests;
    }

    async getBalance(): Promise<any> {
        return this.rest.get('/users/@me/virtual-currency/balance');
    }

    async claimReward(questId: string): Promise<any> {
        // Truyền body rỗng đúng chuẩn chống lỗi Invalid Form Body
        return this.rest.post(`/quests/${questId}/claim-reward`, { body: {} });
    }
}

export class QuestStore {
    private pool = new Map<string, Quest>();
    private engine: HieuTool;

    constructor(engine: HieuTool, list: Quest[] = []) {
        this.engine = engine;
        list.forEach((q) => this.pool.set(q.id, q));
    }

    pending(): Quest[] {
        return Array.from(this.pool.values()).filter((q) =>
            q.id !== '1412491570820812933' && !q.isCompleted() && !q.isExpired(),
        );
    }

    claimable(): Quest[] {
        return Array.from(this.pool.values()).filter((q) => q.isCompleted() && !q.isClaimed());
    }

    async enroll(questId: string) {
        const res = await this.engine.rest.post(`/quests/${questId}/enroll`, {
            body: { location: 11, is_targeted: false, metadata_raw: null },
        });
        this.pool.get(questId)?.refreshStatus(res as any);
    }

    async grabReward(questId: string) {
        try {
            return await this.engine.claimReward(questId);
        } catch {
            return null;
        }
    }

    async grabAllRewards() {
        for (const q of this.claimable()) {
            await this.grabReward(q.id);
            await new Promise((r) => setTimeout(r, 3000)); // Delay giữa các lần nhận thưởng chống spam
        }
    }

    private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

    async execute(quest: Quest) {
        const taskType = quest.detectTaskType();
        if (!taskType) return;

        if (!quest.isEnrolled()) {
            await this.enroll(quest.id);
            await this.sleep(2000);
        }

        const target = quest.getTarget();
        let done = quest.getProgress();

        // Xử lý xem video an toàn (WATCH_VIDEO & WATCH_VIDEO_ON_MOBILE)
        if (taskType === TaskType.WATCH_VIDEO || taskType === TaskType.WATCH_VIDEO_ON_MOBILE) {
            const enrolledAt = new Date(quest.userStatus?.enrolled_at as any).getTime();
            while (done < target) {
                const next = Math.min(target, done + 7);
                try {
                    const res = (await this.engine.rest.post(`/quests/${quest.id}/video-progress`, {
                        body: { timestamp: next + Math.random() },
                    })) as any;
                    quest.refreshStatus(res);
                    done = next;
                } catch (e: any) {
                    if (e.message?.includes('Unauthorized')) {
                        console.log('[Lỗi] Token không hợp lệ!');
                        break;
                    }
                    break;
                }
                await this.sleep(3000); // Giãn cách 3 giây giữa các nhịp gửi tiến trình video
            }
        } 
        // Xử lý giả lập chơi game / streaming (PLAY_ON_DESKTOP & STREAM_ON_DESKTOP)
        else if (taskType === TaskType.PLAY_ON_DESKTOP || taskType === TaskType.STREAM_ON_DESKTOP) {
            const tasks = quest.config.task_config_v2?.tasks ?? quest.config.task_config?.tasks;
            const taskDef = tasks?.[taskType] as any;
            const appId = taskDef?.applications?.[0]?.id ?? quest.config.application.id;

            while (!quest.isCompleted()) {
                try {
                    const res = await this.engine.rest.post(`/quests/${quest.id}/heartbeat`, {
                        body: { application_id: appId, terminal: false },
                    });
                    quest.refreshStatus(res as any);
                } catch (e: any) {
                    if (e.message?.includes('Unauthorized')) {
                        break;
                    }
                }
                await this.sleep(60_000); // Gửi nhịp heartbeat đều đặn mỗi 60 giây theo chuẩn Discord
            }
            
            try {
                await this.engine.rest.post(`/quests/${quest.id}/heartbeat`, {
                    body: { application_id: appId, terminal: true },
                });
            } catch {}
        }

        await this.sleep(2000);
        await this.grabReward(quest.id);
    }
}
