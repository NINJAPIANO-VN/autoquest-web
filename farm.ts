import { GatewayDispatchEvents } from 'discord-api-types/v10';
import chalk from 'chalk';
import Table from 'cli-table3';
import { HieuTool, Quest, TaskType } from './src/engine';

const app = new HieuTool(process.env.TOKEN as string);

function enterAltScreen() {
	process.stdout.write('\x1b[?1049h\x1b[?25l');
}

function exitAltScreen() {
	process.stdout.write('\x1b[?25h\x1b[?1049l');
}


process.on('SIGINT', () => {
	exitAltScreen();
	process.exit(0);
});

const BANNER = `
${chalk.hex('#FF6B6B')('   __  __')}${chalk.hex('#FF8E53')('   ____')}${chalk.hex('#FECA57')('   ______')}${chalk.hex('#48DBFB')('   __  __')}${chalk.hex('#FF9FF3')('   ______')}${chalk.hex('#54A0FF')('   ____')}${chalk.hex('#5F27CD')('    ____')}${chalk.hex('#01A3A4')('    __ ')}
${chalk.hex('#FF6B6B')('  / / / /')}${chalk.hex('#FF8E53')('  /  _/')}${chalk.hex('#FECA57')('  / ____/')}${chalk.hex('#48DBFB')('  / / / /')}${chalk.hex('#FF9FF3')(' /_  __/')}${chalk.hex('#54A0FF')('  / __ \\\\')}${chalk.hex('#5F27CD')('  / __ \\\\')}${chalk.hex('#01A3A4')('  / / ')}
${chalk.hex('#FF6B6B')(' / /_/ /')}${chalk.hex('#FF8E53')('  / /')}${chalk.hex('#FECA57')('   / __/')}${chalk.hex('#48DBFB')('   / / / /')}${chalk.hex('#FF9FF3')('   / /')}${chalk.hex('#54A0FF')('   / / / /')}${chalk.hex('#5F27CD')(' / / / /')}${chalk.hex('#01A3A4')(' / /  ')}
${chalk.hex('#FF6B6B')('/ __  /')}${chalk.hex('#FF8E53')('  / /')}${chalk.hex('#FECA57')('   / /___')}${chalk.hex('#48DBFB')('  / /_/ /')}${chalk.hex('#FF9FF3')('   / /')}${chalk.hex('#54A0FF')('   / /_/ /')}${chalk.hex('#5F27CD')(' / /_/ /')}${chalk.hex('#01A3A4')(' / /___')}
${chalk.hex('#FF6B6B')('/_/ /_/')}${chalk.hex('#FF8E53')('  \\\\___/')}${chalk.hex('#FECA57')('  \\\\____/')}${chalk.hex('#48DBFB')('   \\\\____/')}${chalk.hex('#FF9FF3')('   /_/')}${chalk.hex('#54A0FF')('    \\\\____/')}${chalk.hex('#5F27CD')(' \\\\____/')}${chalk.hex('#01A3A4')('  /_____/')}
`;

const DIVIDER = chalk.hex('#2C3E50')('━'.repeat(90));
const DOT = chalk.hex('#636e72')('│');

type RunState = 'working' | 'done' | 'claimed' | 'skipped' | 'failed';

type LiveQuest = {
	id: string;
	label: string;
	reward: string;
	countdown: number;
	taskIcon: string;
	state: RunState;
};

let live: LiveQuest[] = [];
let orbs: number | null = null;

function taskName(t: TaskType | null): string {
	switch (t) {
		
		case TaskType.WATCH_VIDEO: return 'Watch Video';
		case TaskType.WATCH_VIDEO_ON_MOBILE: return 'Watch Video (Mobile)';
		case TaskType.WATCH_STREAM: return 'Watch Stream';
		
		
		case TaskType.PLAY_ON_DESKTOP: return 'Play (Desktop)';
		case TaskType.STREAM_ON_DESKTOP: return 'Stream (Desktop)';
		
		
		case TaskType.PLAY_ON_XBOX: return 'Play (Xbox)';
		case TaskType.PLAY_ON_PLAYSTATION: return 'Play (PS5)';
		case TaskType.PLAY_ON_NINTENDO: return 'Play (Nintendo)';
		
		
		case TaskType.PLAY_ON_MOBILE: return 'Play (Mobile)';
		case TaskType.PLAY_ACTIVITY: return 'Activity';
		case TaskType.PLAY_SOCIAL_GAME: return 'Social Game';
		
		
		case TaskType.FOLLOW_SOCIAL: return 'Follow Social';
		case TaskType.SHARE_CONTENT: return 'Share Content';
		case TaskType.JOIN_COMMUNITY: return 'Join Community';
		case TaskType.COMPLETE_SURVEY: return 'Survey';
		
		
		case TaskType.MAKE_PURCHASE: return 'Purchase';
		case TaskType.REDEEM_CODE: return 'Redeem Code';
		
		default: return 'Unknown';
	}
}

function taskIcon(t: TaskType | null): string {
	switch (t) {
		
		case TaskType.WATCH_VIDEO:
		case TaskType.WATCH_VIDEO_ON_MOBILE:
			return '🎬';
		case TaskType.WATCH_STREAM:
			return '📹';
		
		
		case TaskType.PLAY_ON_DESKTOP:
			return '🎮';
		case TaskType.STREAM_ON_DESKTOP:
			return '📡';
		
		
		case TaskType.PLAY_ON_XBOX:
			return '🎯';
		case TaskType.PLAY_ON_PLAYSTATION:
			return '🎪';
		case TaskType.PLAY_ON_NINTENDO:
			return '🔴';
		
		
		case TaskType.PLAY_ON_MOBILE:
			return '📱';
		case TaskType.PLAY_ACTIVITY:
		case TaskType.PLAY_SOCIAL_GAME:
			return '🕹️';
		
		
		case TaskType.FOLLOW_SOCIAL:
			return '👥';
		case TaskType.SHARE_CONTENT:
			return '📤';
		case TaskType.JOIN_COMMUNITY:
			return '🏘️';
		case TaskType.COMPLETE_SURVEY:
			return '📋';
		
		
		case TaskType.MAKE_PURCHASE:
			return '💳';
		case TaskType.REDEEM_CODE:
			return '🎁';
		
		default:
			return '❓';
	}
}

function clock(sec: number): string {
	if (sec <= 0) return chalk.hex('#00d2d3').bold('● DONE');
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	const parts: string[] = [];
	if (h > 0) parts.push(chalk.hex('#feca57')(`${h}h`));
	parts.push(chalk.hex('#ff9f43')(`${m}m`));
	parts.push(chalk.hex('#ee5a24')(`${s}s`));
	return parts.join(' ');
}

function stateLabel(s: RunState): string {
	switch (s) {
		case 'working': return chalk.hex('#0984e3')('⟳ RUNNING');
		case 'done': return chalk.hex('#00b894')('✔ DONE');
		case 'claimed': return chalk.hex('#6c5ce7')('★ CLAIMED');
		case 'skipped': return chalk.hex('#636e72')('⊘ SKIP');
		case 'failed': return chalk.hex('#d63031')('✖ FAIL');
	}
}

function draw(user: { username: string; id: string }) {
	const now = new Date();
	const timeStr = chalk.hex('#dfe6e9')(
		`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`,
	);

	const tbl = new Table({
		chars: {
			'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
			'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
			'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
			'right': '│', 'right-mid': '┤', 'middle': '│',
		},
		head: [
			chalk.hex('#636e72')('#'),
			chalk.hex('#dfe6e9').bold('QUEST'),
			chalk.hex('#dfe6e9').bold('TYPE'),
			chalk.hex('#dfe6e9').bold('REWARD'),
			chalk.hex('#dfe6e9').bold('REMAINING'),
			chalk.hex('#dfe6e9').bold('STATUS'),
		],
		colWidths: [4, 32, 9, 18, 14, 13],
		colAligns: ['center', 'left', 'center', 'center', 'center', 'center'],
		style: { border: ['#2d3436'], head: [], 'padding-left': 1, 'padding-right': 1 },
	});

	live.forEach((q, i) => {
		const nameColor = q.state === 'working' ? '#74b9ff' : q.state === 'claimed' ? '#a29bfe' : '#b2bec3';
		tbl.push([
			chalk.hex('#636e72')(`${i + 1}`),
			chalk.hex(nameColor)(q.label.length > 30 ? q.label.slice(0, 28) + '..' : q.label),
			q.taskIcon,
			chalk.hex('#fd79a8')(q.reward),
			clock(q.countdown),
			stateLabel(q.state),
		]);
	});

	const working = live.filter((q) => q.state === 'working').length;
	const finished = live.filter((q) => q.state === 'done' || q.state === 'claimed').length;
	const bar = chalk.hex('#00b894')('█'.repeat(finished)) + chalk.hex('#2d3436')('░'.repeat(Math.max(0, live.length - finished)));

	const frame = [
		BANNER,
		DIVIDER,
		`  ${chalk.hex('#74b9ff').bold('⦿')} ${chalk.hex('#dfe6e9')('Account:')} ${chalk.hex('#ffeaa7').bold(user.username)} ${chalk.hex('#636e72')('|')} ${chalk.hex('#dfe6e9')('ID:')} ${chalk.hex('#81ecec')(user.id)} ${chalk.hex('#636e72')('|')} ${chalk.hex('#dfe6e9')('Orbs:')} ${chalk.hex('#a29bfe').bold(orbs !== null ? `🔮 ${orbs}` : '...')} ${chalk.hex('#636e72')('|')} ${timeStr}`,
		DIVIDER,
		tbl.toString(),
		'',
		`  ${chalk.hex('#636e72')('Progress')} ${bar} ${chalk.hex('#dfe6e9')(`${finished}/${live.length}`)} ${chalk.hex('#636e72')(`(${working} active)`)}`,
		'',
		`  ${chalk.hex('#636e72')('Press')} ${chalk.hex('#dfe6e9').bold('Ctrl+C')} ${chalk.hex('#636e72')('to stop')}`,
	].join('\n');

	
	process.stdout.write('\x1b[H\x1b[J' + frame);
}

function report(user: { username: string; id: string }, results: PromiseSettledResult<void>[]) {
	console.log(`\n${DIVIDER}`);
	console.log(chalk.hex('#ffeaa7').bold('  ★ EXECUTION REPORT'));
	console.log(DIVIDER);

	const rptTable = new Table({
		chars: {
			'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
			'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
			'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
			'right': '│', 'right-mid': '┤', 'middle': '│',
		},
		head: [
			chalk.hex('#dfe6e9')('QUEST'),
			chalk.hex('#dfe6e9')('TYPE'),
			chalk.hex('#dfe6e9')('RESULT'),
			chalk.hex('#dfe6e9')('REWARD'),
		],
		colWidths: [32, 9, 12, 18],
		style: { border: ['#2d3436'], head: [] },
	});

	results.forEach((r, i) => {
		const q = live[i];
		if (!q) return;
		if (r.status === 'fulfilled') {
			rptTable.push([
				chalk.hex('#74b9ff')(q.label.slice(0, 30)),
				q.taskIcon,
				chalk.hex('#00b894').bold('SUCCESS'),
				chalk.hex('#ffeaa7')(q.reward),
			]);
		} else {
			const msg = (r.reason as any)?.message?.slice(0, 20) || 'Error';
			rptTable.push([
				chalk.hex('#74b9ff')(q.label.slice(0, 30)),
				q.taskIcon,
				chalk.hex('#d63031').bold('FAILED'),
				chalk.hex('#d63031')(msg),
			]);
		}
	});

	console.log(rptTable.toString());
	console.log(`\n  ${chalk.hex('#a29bfe').bold(`🔮 Final Orbs: ${orbs ?? '?'}`)}  ${chalk.hex('#636e72')('|')}  ${chalk.hex('#00b894')('✨ All tasks finished')}`);
	console.log(DIVIDER);
}

app.once(
	GatewayDispatchEvents.Ready,
	async ({ data }: { data: { user: { username: string; id: string } } }) => {
		try {
			const bal = await app.getBalance();
			orbs = bal.balance;
		} catch { }

		const store = await app.loadQuests();
		const pending = store.pending();

		const unclaimed = store.claimable();
		if (unclaimed.length > 0) {
			await store.grabAllRewards();
		}

		if (pending.length === 0) {
			process.stdout.write('\x1bc'); 
			console.log(BANNER);
			console.log(DIVIDER);
			console.log(`  ${chalk.hex('#74b9ff').bold('⦿')} ${chalk.hex('#ffeaa7').bold(data.user.username)} ${chalk.hex('#636e72')('|')} ${chalk.hex('#a29bfe')(`🔮 ${orbs ?? '?'} Orbs`)}`);
			console.log(DIVIDER);
			console.log(chalk.hex('#636e72')('\n  No pending quests. All caught up! ✨\n'));

			const allQuests = store.all();
			if (allQuests.length > 0) {
				const summaryTbl = new Table({
					chars: {
						'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
						'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
						'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
						'right': '│', 'right-mid': '┤', 'middle': '│',
					},
					head: [chalk.hex('#dfe6e9')('Quest'), chalk.hex('#dfe6e9')('Status'), chalk.hex('#dfe6e9')('Reward'), chalk.hex('#dfe6e9')('Type')],
					colWidths: [30, 14, 18, 10],
					style: { border: ['#2d3436'], head: [] },
				});
				allQuests.forEach((q) => {
					let st = '❓';
					if (q.isClaimed()) st = chalk.hex('#6c5ce7')('★ Claimed');
					else if (q.isCompleted()) st = chalk.hex('#00b894')('✔ Done');
					else if (q.isExpired()) st = chalk.hex('#636e72')('⏰ Expired');
					else st = chalk.hex('#0984e3')('⏳ Active');
					summaryTbl.push([
						chalk.hex('#74b9ff')(q.name.slice(0, 28)),
						st,
						chalk.hex('#fd79a8')(q.getRewardLabel()),
						taskIcon(q.detectTaskType())
					]);
				});
				console.log(summaryTbl.toString());
			}
			return;
		}

		live = pending.map((q) => ({
			id: q.id,
			label: q.name,
			reward: q.getRewardLabel(),
			countdown: q.getRemaining(),
			taskIcon: taskIcon(q.detectTaskType()),
			state: 'working' as RunState,
		}));

		
		enterAltScreen();

		const ticker = setInterval(() => {
			live.forEach((q) => {
				if (q.state === 'working' && q.countdown > 0) q.countdown--;
				else if (q.state === 'working' && q.countdown <= 0) q.state = 'done';
			});
			draw(data.user);
		}, 1000);

		const results = await Promise.allSettled(
			pending.map((q) => store.execute(q)),
		);

		clearInterval(ticker);

		
		exitAltScreen();

		results.forEach((r, i) => {
			if (!live[i]) return;
			live[i].state = r.status === 'fulfilled' ? 'claimed' : 'failed';
			live[i].countdown = 0;
		});

		try {
			const bal = await app.getBalance();
			const gained = orbs !== null ? bal.balance - orbs : 0;
			orbs = bal.balance;
			if (gained > 0) {
				console.log(chalk.hex('#a29bfe')(`\n  🔮 Orbs gained: +${gained}`));
			}
		} catch { }

		draw(data.user);
		report(data.user, results);
	},
);

app.start();
