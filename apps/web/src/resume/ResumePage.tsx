import { EnvelopeIcon, PhoneIcon, ArrowUpRightIcon } from '@heroicons/react/24/outline';
import source from '../../../../readme.md?raw';
import { blockText, parseResumeSections, safeLink } from './resume-source';
import type { ResumeBlock } from './resume-source';
import './resume.css';

const sections = parseResumeSections(source);
const findSection = (title: string) => sections.find(section => section.title === title);

function Inline({ text }: { text: string }) {
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>]+)/g;
  const nodes = [];
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > position) nodes.push(text.slice(position, match.index));
    if (match[1]) nodes.push(<strong key={match.index}><Inline text={match[1]} /></strong>);
    else if (match[2]) nodes.push(<code key={match.index}>{match[2]}</code>);
    else {
      const href = safeLink(match[4] ?? match[5]);
      nodes.push(href ? <a key={match.index} href={href} target="_blank" rel="noreferrer">{match[3] ?? match[5]}</a> : (match[3] ?? match[5]));
    }
    position = match.index + match[0].length;
  }
  nodes.push(text.slice(position));
  return <>{nodes}</>;
}

function Blocks({ blocks }: { blocks: ResumeBlock[] }) {
  return blocks.map((block, index) => {
    if (block.type === 'paragraph') return <p key={index}><Inline text={block.text} /></p>;
    if (block.type === 'heading') {
      const heading = /^(.*?)[（(]\s*(\d{4}.*?)[）)]$/.exec(block.text);
      return <h3 className="proj-head" key={index}><span className="proj-name">{heading?.[1] ?? block.text}</span>{heading && <span className="proj-date">{heading[2]}</span>}</h3>;
    }
    const items = block.items.map((item, itemIndex) => <li key={itemIndex}><Blocks blocks={item} /></li>);
    return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
  });
}

function SourceSection({ title, className = '' }: { title: string; className?: string }) {
  const section = findSection(title);
  if (!section) return null;
  return <section className={className} aria-label={title}><h2 className="section-title">{title}</h2><Blocks blocks={section.blocks} /></section>;
}

export function ResumePage() {
  const personal = blockText(findSection('个人相关')?.blocks ?? []);
  const contacts = blockText(findSection('联系方式')?.blocks ?? []);
  const summary = blockText(findSection('个人总结')?.blocks ?? []);
  const name = /姓名：([^\n]+)/.exec(personal)?.[1] ?? '';
  const education = /毕业院校及专业：([^\n]+)/.exec(personal)?.[1];
  const github = /\]\((https:\/\/github\.com\/[^)]+)\)/.exec(personal)?.[1];
  const phone = /电话：([^\n]+)/.exec(contacts)?.[1];
  const email = /邮箱：([^\n]+)/.exec(contacts)?.[1];
  const metrics = [
    { value: /(\d+)\s*年前端/.exec(summary)?.[1], unit: '年', label: '前端研发经验' },
    { value: /独立开发维护\s*([\d.k+]+)\s*star/.exec(summary)?.[1], unit: 'stars', label: '独立开发维护项目' },
    { value: /核心参与\s*([\d.k+]+)\s*star/.exec(summary)?.[1], unit: 'stars', label: '核心参与开源项目' },
  ].filter(metric => metric.value);
  const jobs = findSection('工作经历')?.blocks.find(block => block.type === 'list');
  const projects = findSection('项目经验')?.blocks ?? [];
  const projectGroups: ResumeBlock[][] = [];
  for (const block of projects) {
    if (block.type === 'heading' || !projectGroups.length) projectGroups.push([]);
    projectGroups.at(-1)!.push(block);
  }

  return <article className="resume-document" id="resume" tabIndex={-1} aria-label={`${name}的简历`}>
    <header className="header">
      <div><p className="document-label">RESUME</p><h1 className="name serif">{name}</h1><p className="tagline">前端工程师</p></div>
      <address className="contact" aria-label="联系方式">
        {phone && <a href={`tel:${phone}`}><PhoneIcon aria-hidden="true" />{phone}</a>}
        {email && <a href={`mailto:${email}`}><EnvelopeIcon aria-hidden="true" />{email}</a>}
        {github && <a href={github} target="_blank" rel="noreferrer"><ArrowUpRightIcon aria-hidden="true" />GitHub · {github.split('/').at(-1)}</a>}
      </address>
    </header>
    <div className="metrics" aria-label="经历概览">{metrics.map(metric => <div className="metric" key={metric.label}><span className="metric-value serif">{metric.value}<span className="unit">{metric.unit}</span></span><span className="metric-label">{metric.label}</span></div>)}</div>
    <SourceSection title="个人总结" className="summary" />
    <section aria-label="工作经历"><h2 className="section-title">工作经历</h2><div className="timeline">{jobs?.type === 'list' && jobs.items.map((item, index) => {
      const text = blockText(item);
      const job = /^(.*?)\s+-\s+(.+)$/.exec(text);
      return <div className="tl-step" key={index}><div className="tl-top"><span className="tl-year serif">{job?.[1]}</span><span className="tl-head">{job?.[2] ?? text}</span></div></div>;
    })}</div></section>
    <section aria-label="项目经验"><h2 className="section-title">项目经验</h2>{projectGroups.map((blocks, index) => <div className="project" key={index}><Blocks blocks={blocks} /></div>)}</section>
    <SourceSection title="个人项目及作品" className="personal-projects" />
    {education && <section aria-label="教育背景"><h2 className="section-title">教育背景</h2><div className="edu-row"><p>{education}</p></div></section>}
  </article>;
}
