import React, { useRef, useState, useCallback, useEffect , useMemo} from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, Dimensions,
  TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CharacterRenderer } from '@/components/characters/CharacterRenderer';
import { getCharacter, CHARACTERS } from '@/constants/characters';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/stores/auth-store';
import { useTaskStore } from '@/stores/task-store';
import { usePetStore } from '@/stores/pet-store';
import { useGoalStore } from '@/stores/goal-store';
import { useHabitStore } from '@/stores/habit-store';
import { useFinanceStore } from '@/stores/finance-store';
import { taskCategories } from '@/constants/categories';
import { priorities } from '@/constants/priorities';
import { VoiceButton, VoiceOverlay, DictationModal } from '@/components/voice';
import { useVoice } from '@/hooks/use-voice';
import { useWakeWord } from '@/hooks/use-wake-word';
import { api } from '@/services/api';

const { width: SW } = Dimensions.get('window');
const SWIPE_TH = SW * 0.2;
const PAGES = 7;
const PAGE_ICONS = ['🛡️', '🏠', '📋', '🔁', '📆', '🎯', '💰'];
const START = 1;

const CAT_CLR: Record<string, string> = {
  work: taskCategories.work.color,
  personal: taskCategories.personal.color,
  health: taskCategories.health.color,
  finance: taskCategories.finance.color,
  education: taskCategories.education.color,
  home: taskCategories.home.color,
};
const PRI_CLR: Record<string, string> = {
  high: priorities.high.color,
  medium: priorities.medium.color,
  low: priorities.low.color,
};

function Dots({ c: currentPage }: { c: number }) {
  const c = useColors();
  const s = useMemo(() => createS(c), [c]);
  return (<View style={s.dotsRow}>{PAGE_ICONS.map((ic, i) => (
    <View key={i} style={[s.dot, currentPage === i && s.dotA]}><Text style={{ fontSize: currentPage === i ? 13 : 9, opacity: currentPage === i ? 1 : 0.4 }}>{ic}</Text></View>
  ))}</View>);
}

function weekStart() {
  const d = new Date(); const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().split('T')[0];
}
function curMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function Bar({ v, mx, clr, h=6 }: { v:number; mx:number; clr:string; h?:number }) {
  const c = useColors();
  const s = useMemo(() => createS(c), [c]);
  const p = mx > 0 ? Math.min(100, (v/mx)*100) : 0;
  return (<View style={[s.barBg, {height:h}]}><View style={[s.barFl, {width:`${p}%`, backgroundColor:clr, height:h}]}/></View>);
}

export default function SwipeHome() {
  const c = useColors();
  const s = useMemo(() => createS(c), [c]);
  const nav = useNavigation<any>();
  const { token } = useAuthStore();
  const { tasks, fetchTasks, toggleComplete } = useTaskStore();
  const { petData, fetchPet } = usePetStore();
  const { weeklyGoals, yearlyGoals, fetchWeeklyGoals, fetchYearlyGoals } = useGoalStore();
  const { habits, fetchHabits, stats, fetchStats } = useHabitStore();
  const { summary, expenses, fetchSummary, fetchExpenses } = useFinanceStore();
  const pet = petData?.pet || null;

  const [pg, setPg] = useState(START);
  const [ti, setTi] = useState(0);
  const [mana, setMana] = useState(0);
  const [arena, setArena] = useState<any>(null);

  const pOff = useRef(new Animated.Value(-START * SW)).current;
  const tcX = useRef(new Animated.Value(0)).current;
  const tcR = useRef(new Animated.Value(0)).current;
  const tcO = useRef(new Animated.Value(1)).current;

  const today = new Date().toISOString().split('T')[0];
  const mon = curMonth();
  const ws = weekStart();

  useEffect(() => {
    if (!token) return;
    fetchTasks(today); fetchPet(); fetchHabits(); fetchStats(mon);
    fetchWeeklyGoals(ws); fetchYearlyGoals(new Date().getFullYear());
    fetchSummary(mon); fetchExpenses(mon);
    api.get<{ mana: number }>('/challenge/mana', token).then(d=>setMana(d.mana||0)).catch(()=>{});
    api.get<{ profile: any }>('/arena/profile', token).then(d=>setArena(d.profile)).catch(()=>{});
  }, [token]);

  const tday = tasks.filter(t => t.date?.startsWith(today));
  const inc = tday.filter(t => !t.completed);
  const done = tday.filter(t => t.completed);
  const ct = inc[ti] || null;

  const tH = (habits||[]).length;
  const cH = (stats||[]).reduce((s,x)=>s+(x.completed>0?1:0),0);
  const wD = (weeklyGoals||[]).filter(g=>g.completed).length;
  const wT = (weeklyGoals||[]).length;
  const yP = (yearlyGoals||[]).length>0 ? Math.round((yearlyGoals||[]).reduce((s,g)=>s+(g.progress||0),0)/yearlyGoals.length) : 0;
  const sp = summary?.totalExpenses||0;
  const inc$ = summary?.totalIncomes||0;
  const bal = summary?.balance||(inc$-sp);

  const pgR = useRef(START);
  const goP = useCallback((p: number) => {
    const c = Math.max(0, Math.min(PAGES-1, p));
    pgR.current = c; setPg(c);
    Animated.spring(pOff, { toValue: -c*SW, friction:20, tension:80, useNativeDriver:true }).start();
  }, []);

  const ppR = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_,g) => Math.abs(g.dx)>15 && Math.abs(g.dx)>Math.abs(g.dy)*1.5,
    onPanResponderMove: (_,g) => { pOff.setValue(-pgR.current*SW + g.dx); },
    onPanResponderRelease: (_,g) => {
      if (g.dx < -SWIPE_TH && pgR.current < PAGES-1) goP(pgR.current+1);
      else if (g.dx > SWIPE_TH && pgR.current > 0) goP(pgR.current-1);
      else goP(pgR.current);
    },
  })).current;

  const aniOut = useCallback((d:'left'|'right'|'up', cb:()=>void) => {
    const x = d==='left'?-SW:d==='right'?SW:0;
    Animated.parallel([
      Animated.timing(tcX,{toValue:x,duration:250,useNativeDriver:true}),
      Animated.timing(tcO,{toValue:0,duration:200,useNativeDriver:true}),
    ]).start(()=>{ cb(); tcX.setValue(0); tcR.setValue(0); tcO.setValue(1); });
  }, []);

  const swR = useCallback(()=>aniOut('right',()=>setTi(p=>(p+1>=inc.length?0:p+1))), [inc.length]);
  const swL = useCallback(()=>aniOut('left',()=>setTi(p=>(p-1<0?Math.max(0,inc.length-1):p-1))), [inc.length]);
  const swU = useCallback(()=>{
    if(!ct)return;
    aniOut('up',async()=>{
      await toggleComplete(ct.id); await fetchTasks(today);
      api.get<{ mana: number }>('/challenge/mana', token).then(d=>setMana(d.mana||0)).catch(()=>{});
      setTi(p=>Math.min(p, Math.max(0, inc.length-2)));
    });
  }, [ct, inc.length, today]);

  const tpR = useRef(PanResponder.create({
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>10||Math.abs(g.dy)>10,
    onPanResponderMove:(_,g)=>{
      tcX.setValue(g.dx); tcR.setValue(g.dx/SW*15);
      if(g.dy<-50) tcO.setValue(Math.max(0.3,1+g.dy/300));
    },
    onPanResponderRelease:(_,g)=>{
      if(g.dy<-100) swU();
      else if(g.dx>80) swR();
      else if(g.dx<-80) swL();
      else { Animated.parallel([
        Animated.spring(tcX,{toValue:0,friction:8,useNativeDriver:true}),
        Animated.spring(tcR,{toValue:0,friction:8,useNativeDriver:true}),
        Animated.timing(tcO,{toValue:1,duration:150,useNativeDriver:true}),
      ]).start(); }
    },
  })).current;

  const ch = pet ? getCharacter(pet.characterType) : CHARACTERS[0];

  // --- Voice system ---
  const voice = useVoice();
  const [voiceOverlayVisible, setVoiceOverlayVisible] = useState(false);
  const [dictationOpen, setDictationOpen] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);

  // Show overlay when voice becomes active; hide when fully idle
  useEffect(() => {
    if (voice.state === 'recording' || voice.state === 'processing' || voice.state === 'speaking') {
      setVoiceOverlayVisible(true);
    } else if (voice.state === 'error') {
      setVoiceOverlayVisible(true);
    } else if (voice.state === 'idle' && !voice.lastResult) {
      setVoiceOverlayVisible(false);
    }
  }, [voice.state, voice.lastResult]);

  // Auto-dismiss overlay after TTS response finishes
  useEffect(() => {
    if (voice.state === 'speaking') {
      const t = setTimeout(() => setVoiceOverlayVisible(false), 3500);
      return () => clearTimeout(t);
    }
  }, [voice.state]);

  const handleVoicePress = useCallback(() => {
    if (voice.isRecording) {
      voice.stopRecording();
    } else {
      voice.startRecording();
    }
  }, [voice]);

  const handleVoiceCancel = useCallback(() => {
    if (voice.isRecording) voice.cancelRecording();
    setVoiceOverlayVisible(false);
    voice.reset();
  }, [voice]);

  // Wake word integration: only active when voice is idle AND user enabled it
  useWakeWord({
    enabled: wakeWordEnabled && voice.state === 'idle',
    onWakeWord: () => {
      voice.startRecording();
    },
  });

  return (
    <View style={s.root} {...ppR.panHandlers}>
      <SafeAreaView edges={['top']} style={s.topS}><Dots c={pg}/></SafeAreaView>
      <Animated.View style={[s.row,{width:SW*PAGES,transform:[{translateX:pOff}]}]}>

{/* === P0: CHARACTER === */}
<View style={[s.pg,{width:SW}]}>
  <ScrollView contentContainerStyle={s.cPg} showsVerticalScrollIndicator={false}>
    {pet && ch ? (<>
      <CharacterRenderer character={ch} size={160} level={pet.level} showGlow />
      <Text style={s.cName}>{pet.name}</Text>
      <Text style={s.cSub}>{ch.title}</Text>
      <View style={s.stRow}>
        {[{v:`Lv.${pet.level}`,l:'Уровень'},{v:`${pet.streak}🔥`,l:'Серия'},{v:`${mana}🔮`,l:'Мана',c:c.secondary}].map((x,i)=>(
          <View key={i} style={s.stBox}><Text style={[s.stV,x.c?{color:x.c}:null]}>{x.v}</Text><Text style={s.stL}>{x.l}</Text></View>
        ))}
      </View>
      <View style={s.xpO}><View style={[s.xpF,{width:`${Math.min(100,(pet.xp/pet.xpToNext)*100)}%`}]}/><Text style={s.xpT}>{pet.xp}/{pet.xpToNext} XP</Text></View>
      <View style={s.bRow}>
        <View style={s.bC}><Text style={s.bL}>❤️ {Math.round(pet.health)}</Text><View style={s.bBg}><View style={[s.bF,{width:`${pet.health}%`,backgroundColor:c.danger}]}/></View></View>
        <View style={s.bC}><Text style={s.bL}>😊 {Math.round(pet.happiness)}</Text><View style={s.bBg}><View style={[s.bF,{width:`${pet.happiness}%`,backgroundColor:c.warning}]}/></View></View>
      </View>
      {arena&&(<TouchableOpacity style={s.arCard} onPress={()=>nav.navigate('Arena')} activeOpacity={0.8}>
        <Text style={s.arT}>⚔️ Арена</Text>
        <View style={s.r}><Text style={s.arS}>🏆 {arena.trophies}</Text><Text style={s.arS}>{arena.wins}W/{arena.losses}L</Text><Text style={[s.arS,{color:c.accent}]}>⚡{Math.round(arena.powerScore)}</Text></View>
      </TouchableOpacity>)}
      <View style={s.qA}>
        {[{t:'🛡️ Экип.',s:'character-select'},{t:'⚔️ Арена',s:'Arena'},{t:'🏅 Достиж.',s:'Achievements'}].map(b=>(
          <TouchableOpacity key={b.s} style={s.qB} onPress={()=>nav.navigate(b.s)}><Text style={s.qBT}>{b.t}</Text></TouchableOpacity>
        ))}
      </View>
      <Text style={s.hn}>→ главная</Text>
    </>) : (<View style={s.cen}><ActivityIndicator color={c.primary} size="large"/></View>)}
  </ScrollView>
</View>

{/* === P1: HOME === */}
<View style={[s.pg,{width:SW}]}>
  <ScrollView contentContainerStyle={s.hPg} showsVerticalScrollIndicator={false}>
    <Text style={s.gr}>{new Date().getHours()<12?'☀️ Доброе утро':new Date().getHours()<18?'🌤️ Добрый день':'🌙 Добрый вечер'}</Text>
    {pet&&ch&&(<TouchableOpacity style={s.mCR} onPress={()=>goP(0)} activeOpacity={0.8}>
      <CharacterRenderer character={ch} size={50} level={pet.level} showGlow={false}/>
      <View style={s.mCI}><Text style={s.mCN}>{pet.name} Lv.{pet.level}</Text><Bar v={mana} mx={100} clr={c.secondary} h={4}/><Text style={s.mMT}>🔮 {mana}/100</Text></View>
      <Text style={s.arr}>←</Text>
    </TouchableOpacity>)}

    <View style={s.cd}>
      <Text style={s.cdT}>📊 Сегодня</Text>
      <View style={s.pR}>
        <View style={s.pI}><Text style={s.pN}>{done.length}</Text><Text style={s.pL}>Сделано</Text></View>
        <View style={s.dv}/>
        <View style={s.pI}><Text style={[s.pN,{color:c.warning}]}>{inc.length}</Text><Text style={s.pL}>Осталось</Text></View>
        <View style={s.dv}/>
        <View style={s.pI}><Text style={[s.pN,{color:c.success}]}>{tday.length>0?Math.round(done.length/tday.length*100):0}%</Text><Text style={s.pL}>Прогресс</Text></View>
      </View>
    </View>

    <View style={s.smRow}>
      <TouchableOpacity style={s.smCard} onPress={()=>goP(3)}><Text style={s.smIc}>🔁</Text><Text style={s.smV}>{cH}/{tH}</Text><Text style={s.smL}>Привычки</Text></TouchableOpacity>
      <TouchableOpacity style={s.smCard} onPress={()=>goP(4)}><Text style={s.smIc}>📆</Text><Text style={s.smV}>{wD}/{wT}</Text><Text style={s.smL}>Неделя</Text></TouchableOpacity>
      <TouchableOpacity style={s.smCard} onPress={()=>goP(5)}><Text style={s.smIc}>🎯</Text><Text style={s.smV}>{yP}%</Text><Text style={s.smL}>Год</Text></TouchableOpacity>
      <TouchableOpacity style={s.smCard} onPress={()=>goP(6)}><Text style={s.smIc}>💰</Text><Text style={[s.smV,{color:bal>=0?c.success:c.danger}]}>{Math.round(bal).toLocaleString()}</Text><Text style={s.smL}>Баланс</Text></TouchableOpacity>
    </View>

    {/* AI камеры — большие плитки */}
    <View style={s.aiTilesRow}>
      <TouchableOpacity
        style={[s.aiTile,{borderColor:c.primary,backgroundColor:'rgba(99,102,241,0.15)'}]}
        onPress={()=>nav.navigate('ScheduleImport')}
        activeOpacity={0.85}
      >
        <Text style={s.aiTileIc}>📸</Text>
        <Text style={s.aiTileT}>План{'\n'}уроков</Text>
        <Text style={s.aiTileS}>Сфоткай расписание</Text>
      </TouchableOpacity>
    </View>

    <View style={s.navG}>
      {[{i:'💬',l:'Чат',sc:'Chat',tb:true},{i:'📝',l:'Привычки',sc:'Habits',tb:true},{i:'🎯',l:'Цели',sc:'Goals',tb:true},{i:'💰',l:'Финансы',sc:'Finance',tb:true},{i:'📖',l:'Дневник',sc:'Journal',tb:false},{i:'🏟️',l:'Арена',sc:'Arena',tb:false}].map(x=>(
        <TouchableOpacity key={x.sc} style={s.navI} onPress={()=>x.tb?nav.navigate('Tabs',{screen:x.sc}):nav.navigate(x.sc as any)} activeOpacity={0.7}>
          <Text style={s.navIc}>{x.i}</Text><Text style={s.navLb}>{x.l}</Text>
        </TouchableOpacity>
      ))}
    </View>
    <View style={s.hnR}><Text style={s.hn}>← персонаж</Text><Text style={s.hn}>задачи →</Text></View>
  </ScrollView>
</View>

{/* === P2: TASKS === */}
<View style={[s.pg,{width:SW}]}>
  <View style={s.tPg}>
    <Text style={s.pgT}>📋 Задачи на сегодня</Text>
    <Text style={s.pgS}>{inc.length>0?`${ti+1} из ${inc.length}`:'Всё сделано!'}</Text>
    <View style={s.cStack}>
      {inc.length>1&&(<View style={s.cBeh}><Text style={s.cBehT}>{inc[(ti+1)%inc.length]?.title}</Text></View>)}
      {ct?(<Animated.View style={[s.tC,{transform:[{translateX:tcX},{rotate:tcR.interpolate({inputRange:[-15,0,15],outputRange:['-15deg','0deg','15deg']})}],opacity:tcO}]} {...tpR.panHandlers}>
        <View style={[s.catB,{backgroundColor:CAT_CLR[ct.category]||c.textSecondary}]}><Text style={s.catT}>{(taskCategories as any)[ct.category]?.label||ct.category}</Text></View>
        <View style={[s.priD,{backgroundColor:PRI_CLR[ct.priority]||c.textSecondary}]}/>
        <Text style={s.tTi}>{ct.title}</Text>
        {ct.time?<Text style={s.tTm}>⏰ {ct.time}</Text>:null}
        {ct.notes?<Text style={s.tNo} numberOfLines={3}>{ct.notes}</Text>:null}
        <View style={s.mnR}><Text style={s.mnT}>+10 🔮</Text></View>
        <View style={s.sH}><Text style={s.sHL}>← пред.</Text><Text style={s.sHU}>↑ выполнить</Text><Text style={s.sHR}>след. →</Text></View>
      </Animated.View>):(<View style={s.dnC}><Text style={{fontSize:60}}>🎉</Text><Text style={s.dnT}>Всё сделано!</Text><Text style={s.dnS}>{done.length} задач выполнено</Text></View>)}
    </View>
    {done.length>0&&(<View style={s.cmL}><Text style={s.cmT}>✅ Выполнено ({done.length})</Text>
      {done.slice(0,5).map(t=>(<View key={t.id} style={s.cmR}><Text style={s.cmCh}>✓</Text><Text style={s.cmTx}>{t.title}</Text></View>))}
    </View>)}
    <Text style={s.hn}>← главная | привычки →</Text>
  </View>
</View>

{/* === P3: HABITS === */}
<View style={[s.pg,{width:SW}]}>
  <ScrollView contentContainerStyle={s.fPg} showsVerticalScrollIndicator={false}>
    <Text style={s.pgT}>🔁 Привычки</Text>
    <Text style={s.pgS}>{cH}/{tH} выполнено сегодня</Text>
    <Bar v={cH} mx={tH} clr={c.success} h={8}/>

    {(habits||[]).length === 0 ? (
      <View style={s.emSt}><Text style={{fontSize:48}}>🔁</Text><Text style={s.emT}>Нет привычек</Text>
        <TouchableOpacity style={s.addB} onPress={()=>nav.navigate('Tabs',{screen:'Habits'})}><Text style={s.addBT}>+ Добавить</Text></TouchableOpacity>
      </View>
    ) : (
      <View style={{marginTop:12}}>
        {(habits||[]).map((h,i)=>{
          const st = (stats||[]).find(x=>x.habitId===h.id);
          const streak = st?.streak || 0;
          const comp = st?.completed || 0;
          const total = st?.total || 0;
          return (
            <View key={h.id||`h${i}`} style={s.habCard}>
              <View style={s.habLeft}>
                <Text style={s.habName}>{h.name}</Text>
                <Text style={s.habMeta}>{h.category} • {h.frequency}</Text>
                <Bar v={comp} mx={Math.max(total,1)} clr={c.success} h={4}/>
              </View>
              <View style={s.habRight}>
                <Text style={s.habStreak}>{streak}🔥</Text>
                <Text style={s.habRatio}>{comp}/{total}</Text>
              </View>
            </View>
          );
        })}
      </View>
    )}

    <TouchableOpacity style={s.nvB} onPress={()=>nav.navigate('Tabs',{screen:'Habits'})}><Text style={s.nvBT}>📝 Все привычки</Text></TouchableOpacity>
    <Text style={s.hn}>← задачи | неделя →</Text>
  </ScrollView>
</View>

{/* === P4: WEEKLY GOALS === */}
<View style={[s.pg,{width:SW}]}>
  <ScrollView contentContainerStyle={s.fPg} showsVerticalScrollIndicator={false}>
    <Text style={s.pgT}>📆 Цели на неделю</Text>
    <Text style={s.pgS}>{wD}/{wT} выполнено</Text>
    <Bar v={wD} mx={wT} clr={c.warning} h={8}/>
    {wT===0?(<View style={s.emSt}><Text style={{fontSize:48}}>📆</Text><Text style={s.emT}>Нет целей на неделю</Text>
      <TouchableOpacity style={s.addB} onPress={()=>nav.navigate('Tabs',{screen:'Goals'})}><Text style={s.addBT}>+ Добавить</Text></TouchableOpacity>
    </View>):(<View style={{marginTop:12}}>
      {(weeklyGoals||[]).map((g,i)=>(<View key={g.id||`wg${i}`} style={[s.glCard,g.completed&&s.glCardD]}>
        <Text style={s.glIc}>{g.completed?'✅':'⬜'}</Text>
        <Text style={[s.glTx,g.completed&&s.glTxD]} numberOfLines={2}>{g.goalText}</Text>
      </View>))}
    </View>)}
    <TouchableOpacity style={s.nvB} onPress={()=>nav.navigate('Tabs',{screen:'Goals'})}><Text style={s.nvBT}>📝 Все цели</Text></TouchableOpacity>
    <Text style={s.hn}>← привычки | год →</Text>
  </ScrollView>
</View>

{/* === P5: YEARLY GOALS === */}
<View style={[s.pg,{width:SW}]}>
  <ScrollView contentContainerStyle={s.fPg} showsVerticalScrollIndicator={false}>
    <Text style={s.pgT}>🎯 Цели на {new Date().getFullYear()}</Text>
    <Text style={s.pgS}>Средний прогресс: {yP}%</Text>
    <Bar v={yP} mx={100} clr={c.primary} h={8}/>
    {(yearlyGoals||[]).length===0?(<View style={s.emSt}><Text style={{fontSize:48}}>🎯</Text><Text style={s.emT}>Нет годовых целей</Text>
      <TouchableOpacity style={s.addB} onPress={()=>nav.navigate('Tabs',{screen:'Goals'})}><Text style={s.addBT}>+ Добавить</Text></TouchableOpacity>
    </View>):(<View style={{marginTop:12}}>
      {(yearlyGoals||[]).map((g,i)=>{
        const p=Math.round(g.progress||0); const clr=p>=75?c.success:p>=40?c.warning:c.danger;
        return (<View key={g.id||`yg${i}`} style={s.yrCard}>
          <View style={s.yrH}><View style={[s.arBdg,{backgroundColor:CAT_CLR[g.area]||c.primary}]}><Text style={s.arBdgT}>{g.area}</Text></View><Text style={[s.yrPct,{color:clr}]}>{p}%</Text></View>
          <Text style={s.yrTx}>{g.goalText}</Text>
          <Bar v={p} mx={100} clr={clr} h={6}/>
        </View>);
      })}
    </View>)}
    <TouchableOpacity style={s.nvB} onPress={()=>nav.navigate('Tabs',{screen:'Goals'})}><Text style={s.nvBT}>📝 Управление целями</Text></TouchableOpacity>
    <Text style={s.hn}>← неделя | финансы →</Text>
  </ScrollView>
</View>

{/* === P6: FINANCE === */}
<View style={[s.pg,{width:SW}]}>
  <ScrollView contentContainerStyle={s.fPg} showsVerticalScrollIndicator={false}>
    <Text style={s.pgT}>💰 Финансы</Text>
    <Text style={s.pgS}>{new Date().toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</Text>

    <View style={s.balCard}><Text style={s.balL}>Баланс</Text>
      <Text style={[s.balN,{color:bal>=0?c.success:c.danger}]}>{bal>=0?'+':''}{Math.round(bal).toLocaleString()} ₸</Text>
    </View>

    <View style={s.finR}>
      <View style={[s.finC,{borderLeftColor:c.success}]}><Text style={s.finL}>Доходы</Text><Text style={[s.finN,{color:c.success}]}>+{Math.round(inc$).toLocaleString()} ₸</Text></View>
      <View style={[s.finC,{borderLeftColor:c.danger}]}><Text style={s.finL}>Расходы</Text><Text style={[s.finN,{color:c.danger}]}>-{Math.round(sp).toLocaleString()} ₸</Text></View>
    </View>

    {(summary?.topCategories||[]).length>0&&(<View style={s.cd}><Text style={s.cdT}>📊 Топ расходов</Text>
      {(summary?.topCategories||[]).slice(0,5).map((c,i)=>{
        const p=sp>0?Math.round((c.amount/sp)*100):0;
        return (<View key={i} style={s.tcR}><Text style={s.tcN}>{c.category}</Text><View style={s.tcBg}><View style={[s.tcFl,{width:`${p}%`}]}/></View><Text style={s.tcP}>{Math.round(c.amount).toLocaleString()} ₸</Text></View>);
      })}
    </View>)}

    {(expenses||[]).length>0&&(<View style={s.cd}><Text style={s.cdT}>🕐 Последние</Text>
      {(expenses||[]).slice(0,5).map((e,i)=>(<View key={e.id||`e${i}`} style={s.exR}><View><Text style={s.exD}>{e.description}</Text><Text style={s.exC}>{e.category}</Text></View><Text style={s.exA}>-{Math.round(e.amount).toLocaleString()} ₸</Text></View>))}
    </View>)}

    <TouchableOpacity style={s.nvB} onPress={()=>nav.navigate('Tabs',{screen:'Finance'})}><Text style={s.nvBT}>📊 Подробнее</Text></TouchableOpacity>
    <Text style={s.hn}>← цели на год</Text>
  </ScrollView>
</View>

      </Animated.View>

      {/* Floating Voice + Camera buttons */}
      <View style={s.voiceFab} pointerEvents="box-none">
        <TouchableOpacity
          onPress={() => setWakeWordEnabled((v) => !v)}
          style={[s.wakeToggle, wakeWordEnabled && s.wakeToggleOn]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={
            wakeWordEnabled ? 'Выключить голосовую активацию' : 'Включить голосовую активацию'
          }
        >
          <Text style={s.wakeToggleText}>{wakeWordEnabled ? '🎧 Слушаю' : '🔇'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => nav.navigate('TaskCapture')}
          style={s.cameraFab}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Умная камера для задач"
        >
          <Text style={s.cameraFabEmoji}>📸</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setDictationOpen(true)}
          style={s.cameraFab}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="JARVIS диктофон — записать речь, выделить задачи и запомнить факты"
        >
          <Text style={s.cameraFabEmoji}>🎙️</Text>
        </TouchableOpacity>
        <VoiceButton
          onPress={handleVoicePress}
          isRecording={voice.isRecording}
          isProcessing={voice.isProcessing}
          amplitude={voice.amplitude}
        />
      </View>

      {/* JARVIS dictation modal — нажми "🎙️", говори, JARVIS вытащит
          задачи + запомнит факты + ответит голосом. */}
      <DictationModal
        visible={dictationOpen}
        onClose={() => setDictationOpen(false)}
        onResult={() => {
          // Подтянем свежие задачи: диктовка могла создать новые на сегодня.
          fetchTasks(today).catch(() => {});
        }}
      />

      {/* Live voice overlay */}
      <VoiceOverlay
        visible={voiceOverlayVisible}
        state={voice.state}
        liveTranscript={voice.liveTranscript}
        response={voice.lastResult?.response ?? null}
        error={voice.error}
        amplitude={voice.amplitude}
        onCancel={handleVoiceCancel}
        onStop={() => voice.stopRecording()}
      />
    </View>
  );
}

function createS(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  root:{flex:1,backgroundColor:c.background},
  topS:{position:'absolute',top:0,left:0,right:0,zIndex:10},
  voiceFab:{position:'absolute',bottom:24,right:20,zIndex:20,alignItems:'flex-end',gap:10},
  wakeToggle:{backgroundColor:'rgba(30,41,59,0.9)',borderRadius:20,paddingHorizontal:14,paddingVertical:8,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  wakeToggleOn:{borderColor:'rgba(99,102,241,0.6)',backgroundColor:'rgba(99,102,241,0.15)'},
  wakeToggleText:{color:c.text,fontSize:12,fontWeight:'600'},
  // brand-specific
  cameraFab:{width:52,height:52,borderRadius:26,backgroundColor:c.surface,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.08)',shadowColor:'#000',shadowOffset:{width:0,height:4},shadowOpacity:0.3,shadowRadius:6,elevation:8},
  cameraFabEmoji:{fontSize:24},
  dotsRow:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:6,paddingVertical:8},
  dot:{width:24,height:24,borderRadius:12,alignItems:'center',justifyContent:'center'},
  dotA:{backgroundColor:'rgba(99,102,241,0.2)',transform:[{scale:1.15}]},
  cen:{flex:1,alignItems:'center',justifyContent:'center'},
  row:{flex:1,flexDirection:'row',marginTop:48},
  pg:{flex:1},
  pgT:{color:c.text,fontSize:22,fontWeight:'900',marginBottom:4},
  pgS:{color:c.textSecondary,fontSize:fontSize.sm,marginBottom:12},
  hn:{color:'rgba(255,255,255,0.2)',fontSize:fontSize.xs,textAlign:'center',marginTop:12},
  hnR:{flexDirection:'row',justifyContent:'space-between',paddingHorizontal:20,marginTop:8},
  arr:{color:c.textSecondary,fontSize:18,fontWeight:'600'},
  r:{flexDirection:'row',gap:16},
  cd:{backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,marginBottom:12},
  cdT:{color:c.text,fontSize:fontSize.md,fontWeight:'700',marginBottom:8},
  dv:{width:1,height:30,backgroundColor:'rgba(255,255,255,0.1)'},
  fPg:{padding:spacing.lg,paddingBottom:100},
  barBg:{height:6,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:3,overflow:'hidden',marginTop:4},
  barFl:{height:'100%',borderRadius:3},

  // Character
  cPg:{alignItems:'center',padding:spacing.lg,paddingTop:spacing.md,paddingBottom:100},
  cName:{color:c.text,fontSize:24,fontWeight:'900',marginTop:12},
  cSub:{color:c.textSecondary,fontSize:fontSize.md,marginBottom:16},
  stRow:{flexDirection:'row',gap:14,marginBottom:16},
  stBox:{backgroundColor:c.surface,borderRadius:borderRadius.lg,paddingHorizontal:18,paddingVertical:10,alignItems:'center',minWidth:80},
  stV:{color:c.text,fontSize:fontSize.lg,fontWeight:'800'},
  stL:{color:c.textSecondary,fontSize:fontSize.xs,marginTop:2},
  xpO:{width:'90%',height:16,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:8,marginBottom:16,overflow:'hidden',position:'relative'},
  xpF:{height:'100%',backgroundColor:c.primary,borderRadius:8},
  xpT:{position:'absolute',top:0,left:0,right:0,bottom:0,textAlign:'center',lineHeight:16,color:c.text,fontSize:10,fontWeight:'800'},
  bRow:{flexDirection:'row',gap:12,width:'90%',marginBottom:16},
  bC:{flex:1},bL:{color:c.text,fontSize:fontSize.xs,fontWeight:'600',marginBottom:4},
  bBg:{height:8,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:4,overflow:'hidden'},
  bF:{height:'100%',borderRadius:4},
  arCard:{backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,width:'90%',marginBottom:16,borderWidth:1,borderColor:'rgba(255,215,0,0.2)'},
  arT:{color:c.accent,fontSize:fontSize.md,fontWeight:'800',marginBottom:6},
  arS:{color:c.textSecondary,fontSize:fontSize.sm,fontWeight:'600'},
  qA:{flexDirection:'row',gap:10,marginBottom:20},
  qB:{backgroundColor:c.surface,paddingHorizontal:14,paddingVertical:10,borderRadius:borderRadius.md},
  qBT:{color:c.text,fontSize:fontSize.sm,fontWeight:'600'},

  // Home
  hPg:{padding:spacing.lg,paddingBottom:100},
  gr:{color:c.text,fontSize:22,fontWeight:'800',marginBottom:16},
  mCR:{flexDirection:'row',alignItems:'center',backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.sm,marginBottom:16,gap:10},
  mCI:{flex:1},mCN:{color:c.text,fontSize:fontSize.sm,fontWeight:'700'},
  mMT:{color:c.secondary,fontSize:fontSize.xs-1,marginTop:2},
  pR:{flexDirection:'row',alignItems:'center',marginTop:8},
  pI:{flex:1,alignItems:'center'},pN:{color:c.text,fontSize:24,fontWeight:'900'},pL:{color:c.textSecondary,fontSize:fontSize.xs,marginTop:2},
  smRow:{flexDirection:'row',gap:8,marginBottom:16},
  smCard:{flex:1,backgroundColor:c.surface,borderRadius:borderRadius.lg,paddingVertical:12,alignItems:'center'},
  smIc:{fontSize:22,marginBottom:2},smV:{color:c.text,fontSize:fontSize.md,fontWeight:'800'},smL:{color:c.textSecondary,fontSize:fontSize.xs-1},
  navG:{flexDirection:'row',flexWrap:'wrap',gap:10,marginBottom:16},
  navI:{width:(SW-spacing.lg*2-20)/3,backgroundColor:c.surface,borderRadius:borderRadius.lg,paddingVertical:16,alignItems:'center'},
  navIc:{fontSize:28,marginBottom:4},navLb:{color:c.text,fontSize:fontSize.xs,fontWeight:'600'},
  aiTilesRow:{flexDirection:'row',gap:12,marginBottom:14},
  aiTile:{flex:1,borderWidth:1.5,borderRadius:borderRadius.lg,paddingVertical:16,paddingHorizontal:12,alignItems:'center',justifyContent:'center',minHeight:120},
  aiTileIc:{fontSize:34,marginBottom:6},
  aiTileT:{color:c.text,fontSize:fontSize.md,fontWeight:'700',textAlign:'center',lineHeight:18},
  aiTileS:{color:c.textSecondary,fontSize:fontSize.xs,marginTop:4,textAlign:'center'},

  // Tasks
  tPg:{flex:1,padding:spacing.lg,paddingTop:spacing.sm},
  cStack:{flex:1,alignItems:'center',justifyContent:'center',minHeight:280},
  cBeh:{position:'absolute',width:'92%',backgroundColor:c.surface,borderRadius:borderRadius.xl,padding:spacing.lg,opacity:0.3,transform:[{scale:0.95},{translateY:10}]},
  cBehT:{color:c.textSecondary,fontSize:fontSize.sm},
  tC:{width:'100%',backgroundColor:c.surface,borderRadius:borderRadius.xl,padding:spacing.xl,minHeight:240,shadowColor:c.primary,shadowOffset:{width:0,height:8},shadowOpacity:0.15,shadowRadius:20,elevation:10,borderWidth:1,borderColor:'rgba(99,102,241,0.15)'},
  catB:{alignSelf:'flex-start',paddingHorizontal:12,paddingVertical:4,borderRadius:12,marginBottom:10},
  catT:{color:c.text,fontSize:fontSize.xs,fontWeight:'700'},
  priD:{width:12,height:12,borderRadius:6,marginBottom:10},
  tTi:{color:c.text,fontSize:20,fontWeight:'800',marginBottom:8,lineHeight:28},
  tTm:{color:c.warning,fontSize:fontSize.md,fontWeight:'600',marginBottom:8},
  tNo:{color:c.textSecondary,fontSize:fontSize.sm,marginBottom:12,lineHeight:20},
  mnR:{backgroundColor:'rgba(156,39,176,0.1)',borderRadius:borderRadius.md,paddingHorizontal:12,paddingVertical:6,alignSelf:'flex-start',marginBottom:14},
  mnT:{color:c.secondary,fontSize:fontSize.sm,fontWeight:'600'},
  sH:{flexDirection:'row',justifyContent:'space-between',borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.06)',paddingTop:10,marginTop:'auto'},
  sHL:{color:'rgba(255,255,255,0.25)',fontSize:fontSize.xs},
  sHU:{color:'rgba(76,175,80,0.5)',fontSize:fontSize.xs,fontWeight:'700'},
  sHR:{color:'rgba(255,255,255,0.25)',fontSize:fontSize.xs},
  dnC:{width:'100%',backgroundColor:c.surface,borderRadius:borderRadius.xl,padding:spacing.xl,alignItems:'center',minHeight:220,justifyContent:'center',borderWidth:1,borderColor:'rgba(76,175,80,0.3)'},
  dnT:{color:c.success,fontSize:24,fontWeight:'900',marginTop:8},dnS:{color:c.textSecondary,fontSize:fontSize.md},
  cmL:{marginTop:16},cmT:{color:c.textSecondary,fontSize:fontSize.sm,fontWeight:'700',marginBottom:6},
  cmR:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:5},cmCh:{color:c.success,fontSize:fontSize.sm,fontWeight:'800'},cmTx:{color:'rgba(255,255,255,0.4)',fontSize:fontSize.sm,textDecorationLine:'line-through'},

  // Habits
  habCard:{flexDirection:'row',alignItems:'center',backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,marginBottom:8},
  habLeft:{flex:1},habRight:{alignItems:'flex-end',marginLeft:8},
  habName:{color:c.text,fontSize:fontSize.sm,fontWeight:'600'},
  habMeta:{color:c.textSecondary,fontSize:fontSize.xs,marginTop:2,marginBottom:4},
  habStreak:{color:c.warning,fontSize:fontSize.sm,fontWeight:'700'},
  habRatio:{color:c.textSecondary,fontSize:fontSize.xs},
  emSt:{alignItems:'center',paddingVertical:40},emT:{color:c.textSecondary,fontSize:fontSize.md,marginTop:8,marginBottom:12},
  addB:{backgroundColor:c.primary,paddingHorizontal:20,paddingVertical:10,borderRadius:borderRadius.md},addBT:{color:c.text,fontSize:fontSize.sm,fontWeight:'700'},

  // Goals
  glCard:{flexDirection:'row',alignItems:'center',backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,marginBottom:8,gap:12},
  glCardD:{opacity:0.6},glIc:{fontSize:22},glTx:{color:c.text,fontSize:fontSize.md,fontWeight:'600',flex:1},glTxD:{textDecorationLine:'line-through',color:c.textSecondary},

  // Yearly
  yrCard:{backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,marginBottom:10},
  yrH:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:6},
  arBdg:{paddingHorizontal:10,paddingVertical:3,borderRadius:10},arBdgT:{color:c.text,fontSize:fontSize.xs,fontWeight:'700'},
  yrPct:{fontSize:fontSize.lg,fontWeight:'900'},yrTx:{color:c.text,fontSize:fontSize.md,fontWeight:'600',marginBottom:8},

  // Finance
  balCard:{backgroundColor:c.surface,borderRadius:borderRadius.xl,padding:spacing.lg,alignItems:'center',marginBottom:16},
  balL:{color:c.textSecondary,fontSize:fontSize.sm,marginBottom:4},balN:{fontSize:32,fontWeight:'900'},
  finR:{flexDirection:'row',gap:10,marginBottom:16},
  finC:{flex:1,backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,borderLeftWidth:3},
  finL:{color:c.textSecondary,fontSize:fontSize.xs,marginBottom:4},finN:{fontSize:18,fontWeight:'800'},
  tcR:{flexDirection:'row',alignItems:'center',marginTop:8,gap:8},
  tcN:{color:c.text,fontSize:fontSize.sm,fontWeight:'600',width:90},
  tcBg:{flex:1,height:6,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:3,overflow:'hidden'},
  tcFl:{height:'100%',backgroundColor:c.danger,borderRadius:3},
  tcP:{color:c.textSecondary,fontSize:fontSize.xs,width:80,textAlign:'right'},
  exR:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:8,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.04)'},
  exD:{color:c.text,fontSize:fontSize.sm,fontWeight:'600'},exC:{color:c.textSecondary,fontSize:fontSize.xs},
  exA:{color:c.danger,fontSize:fontSize.sm,fontWeight:'700'},
  nvB:{backgroundColor:c.surface,borderRadius:borderRadius.lg,padding:spacing.md,alignItems:'center',marginTop:12,borderWidth:1,borderColor:'rgba(99,102,241,0.2)'},
  nvBT:{color:c.primary,fontSize:fontSize.sm,fontWeight:'700'},
  });
}
