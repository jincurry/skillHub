import {
  BarChart3, Database, Search, PenTool, FileText, Calendar, DollarSign,
  TrendingUp, Package, ClipboardList, Sparkles, Globe, Workflow, Lock,
  MessageSquare, Code, Box, Bot, Mic, GitBranch, Cpu, Zap, BookOpen,
  ScrollText, Wrench, Server, Image, Mail, Settings, Cloud, Shield,
  type LucideIcon,
} from 'lucide-react';

const KEYWORD_ICONS: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/\banaly[zs]is|analyz/i, BarChart3],
  [/\b(market|finance|financial|trading|stock|price|revenue)\b/i, TrendingUp],
  [/\b(money|payment|billing|invoice|cost|fee)\b/i, DollarSign],
  [/\b(calendar|schedule|date|time|deadline)\b/i, Calendar],
  [/\b(meeting|notes?|transcript|minutes)\b/i, ClipboardList],
  [/\b(record|audio|voice|speech|mic)\b/i, Mic],
  [/\b(write|writing|writer|draft|essay|article|blog|post)\b/i, PenTool],
  [/\b(content|document|doc|paper|report)\b/i, FileText],
  [/\b(book|read|reading|reference|wiki|knowledge)\b/i, BookOpen],
  [/\b(research|investigate|explore|discover|find|search|seo)\b/i, Search],
  [/\b(web|browser|scrape|crawler|http|url)\b/i, Globe],
  [/\b(data|dataset|database|sql|query|table|etl)\b/i, Database],
  [/\b(ai|llm|gpt|chat|agent|assistant|bot)\b/i, Bot],
  [/\b(install|package|plugin|extension|setup|deploy)\b/i, Package],
  [/\b(workflow|pipeline|orchestrat|chain|flow)\b/i, Workflow],
  [/\b(task|job|executor|runner|step)\b/i, GitBranch],
  [/\b(creator|generate|generator|build|make|new)\b/i, Sparkles],
  [/\b(auth|login|password|secret|secure|token)\b/i, Lock],
  [/\b(security|guard|protect|policy|compliance)\b/i, Shield],
  [/\b(message|chat|reply|conversation|comment)\b/i, MessageSquare],
  [/\b(mail|email|notify|notification|alert)\b/i, Mail],
  [/\b(image|photo|picture|vision|ocr|visual)\b/i, Image],
  [/\b(code|coding|developer|github|git|repo|programming)\b/i, Code],
  [/\b(infra|server|host|deploy|kubernetes|k8s|docker)\b/i, Server],
  [/\b(cloud|aws|gcp|azure|s3)\b/i, Cloud],
  [/\b(tool|util|utility|helper|fix)\b/i, Wrench],
  [/\b(config|setting|preference|option)\b/i, Settings],
  [/\b(performance|monitor|metric|observ|trace)\b/i, Cpu],
  [/\b(automation|automat|trigger|webhook|hook)\b/i, Zap],
  [/\b(script|prompt|template|skill)\b/i, ScrollText],
];

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const FALLBACK_ICONS: ReadonlyArray<LucideIcon> = [Box, Sparkles, Workflow, ScrollText, Wrench];

export function pickIcon(ns: string, name: string): LucideIcon {
  const haystack = `${name} ${ns}`.replace(/[-_./]+/g, ' ');
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(haystack)) return icon;
  }
  return FALLBACK_ICONS[hash32(`${ns}/${name}`) % FALLBACK_ICONS.length];
}

export function shouldAutoGenerate(icon: string | undefined): boolean {
  return !icon || icon === '?' || icon === '';
}
