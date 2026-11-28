import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

interface VolcanoStrengthChartProps {
  /** Mobilized troop squad power (or active march power) in KK */
  mobilizedPower: number;
  /** Stationed garrison power when the player currently holds the Volcano */
  stationedPower: number;
  /** Target strength benchmark (current Volcano garrison power, or recommended defense target) */
  targetPower: number;
  /** Whether the player's own tribe currently rules the Volcano */
  isOwnRuler: boolean;
}

interface BarDatum {
  id: 'own' | 'target';
  label: string;
  primaryValue: number;
  secondaryValue: number;
  totalValue: number;
  detail: string;
}

function formatKk(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('de-DE');
}

function formatTickKk(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.', ',')}k`;
  return String(Math.round(value));
}

export const VolcanoStrengthChart: React.FC<VolcanoStrengthChartProps> = ({
  mobilizedPower,
  stationedPower,
  targetPower,
  isOwnRuler,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(324);
  const [hoveredId, setHoveredId] = useState<'own' | 'target' | null>(null);

  const safeTarget = Math.max(80, Math.round(targetPower || 380));
  const safeMobilized = Math.max(0, Math.round(mobilizedPower || 0));
  const safeStationed = Math.max(0, Math.round(stationedPower || 0));

  const ownPrimary = isOwnRuler ? safeStationed : safeMobilized;
  const ownSecondary = isOwnRuler ? safeMobilized : 0;
  const ownTotal = ownPrimary + ownSecondary;
  const diff = ownTotal - safeTarget;
  const ratioPct = safeTarget > 0 ? Math.round((ownTotal / safeTarget) * 100) : 0;

  const readinessTone: 'strong' | 'close' | 'weak' =
    ownTotal >= safeTarget ? 'strong' : ownTotal >= safeTarget * 0.85 ? 'close' : 'weak';

  const readinessLabel = isOwnRuler
    ? ownSecondary > 0
      ? `Garnison + ${formatKk(ownSecondary)} KK Verstärkung bereit`
      : ownTotal >= safeTarget
      ? 'Verteidigung über Richtwert'
      : `Noch ${formatKk(safeTarget - ownTotal)} KK bis Richtwert`
    : ownTotal === 0
    ? 'Noch keine Truppen zugewiesen'
    : diff >= 0
    ? `+${formatKk(diff)} KK über Zielwert (${ratioPct} %)`
    : `Noch ${formatKk(Math.abs(diff))} KK bis Zielwert (${ratioPct} %)`;

  const bars: BarDatum[] = useMemo(
    () => [
      {
        id: 'own',
        label: isOwnRuler ? 'Eigener Stamm' : 'Eigener Trupp',
        primaryValue: ownPrimary,
        secondaryValue: ownSecondary,
        totalValue: ownTotal,
        detail: isOwnRuler
          ? ownSecondary > 0
            ? `Garnison ${formatKk(ownPrimary)} KK + Verstärkung ${formatKk(ownSecondary)} KK`
            : `Stationierte Garnison: ${formatKk(ownPrimary)} KK`
          : `Mobilisierte Stärke: ${formatKk(ownTotal)} KK (${ratioPct} % vom Zielwert)`,
      },
      {
        id: 'target',
        label: isOwnRuler ? 'Richtwert' : 'Zielwert',
        primaryValue: safeTarget,
        secondaryValue: 0,
        totalValue: safeTarget,
        detail: isOwnRuler
          ? `Empfohlene Verteidigungsstärke: ${formatKk(safeTarget)} KK`
          : `Benötigte Stärke gegen aktuelle Garnison: ${formatKk(safeTarget)} KK`,
      },
    ],
    [isOwnRuler, ownPrimary, ownSecondary, ownTotal, ratioPct, safeTarget]
  );

  // Responsive width observer so D3 scales cleanly to any panel or viewport width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next >= 180) {
        setContainerWidth(next);
      }
    };

    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // D3 horizontal bar chart rendering
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = Math.max(220, containerWidth);
    const height = 104;
    const margin = { top: 18, right: 54, bottom: 22, left: 92 };
    const innerWidth = Math.max(80, width - margin.left - margin.right);
    const innerHeight = Math.max(44, height - margin.top - margin.bottom);

    const maxVal = Math.max(safeTarget, ownTotal, 100) * 1.12;
    const xScale = d3.scaleLinear().domain([0, maxVal]).nice(4).range([0, innerWidth]);
    const yScale = d3
      .scaleBand<'own' | 'target'>()
      .domain(['own', 'target'])
      .range([0, innerHeight])
      .padding(0.32);

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transitionMs = reducedMotion ? 0 : 180;

    const svg = d3.select(svgEl);
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Subtle vertical gridlines
    const ticks = xScale.ticks(3);
    g.append('g')
      .attr('class', 'volc-d3-grid')
      .selectAll('line')
      .data(ticks)
      .join('line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'rgba(245, 239, 230, 0.08)')
      .attr('stroke-width', 1);

    // Background tracks for visual measure
    g.selectAll('rect.volc-d3-track')
      .data(bars)
      .join('rect')
      .attr('class', 'volc-d3-track')
      .attr('x', 0)
      .attr('y', (d) => yScale(d.id) ?? 0)
      .attr('width', innerWidth)
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', 'rgba(245, 239, 230, 0.045)');

    const ownFill =
      readinessTone === 'strong'
        ? '#4ade80'
        : readinessTone === 'close'
        ? '#f59e0b'
        : '#f87171';

    // Primary bars
    const primaryBars = g
      .selectAll<SVGRectElement, BarDatum>('rect.volc-d3-bar-primary')
      .data(bars, (d) => d.id)
      .join('rect')
      .attr('class', 'volc-d3-bar-primary')
      .attr('x', 0)
      .attr('y', (d) => yScale(d.id) ?? 0)
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => (d.id === 'own' ? ownFill : 'rgba(245, 239, 230, 0.24)'))
      .attr('opacity', (d) => (hoveredId && hoveredId !== d.id ? 0.55 : 0.95))
      .style('cursor', 'pointer')
      .on('mouseenter', (_ev, d) => setHoveredId(d.id))
      .on('mouseleave', () => setHoveredId(null));

    if (transitionMs > 0) {
      primaryBars
        .attr('width', 0)
        .transition()
        .duration(transitionMs)
        .ease(d3.easeCubicOut)
        .attr('width', (d) => Math.max(d.primaryValue > 0 ? 3 : 0, xScale(d.primaryValue)));
    } else {
      primaryBars.attr('width', (d) => Math.max(d.primaryValue > 0 ? 3 : 0, xScale(d.primaryValue)));
    }

    // Stacked secondary bar (ready reinforcement when player already rules Volcano)
    const secondaryData = bars.filter((d) => d.id === 'own' && d.secondaryValue > 0);
    if (secondaryData.length > 0) {
      const secBars = g
        .selectAll<SVGRectElement, BarDatum>('rect.volc-d3-bar-secondary')
        .data(secondaryData)
        .join('rect')
        .attr('class', 'volc-d3-bar-secondary')
        .attr('x', (d) => xScale(d.primaryValue))
        .attr('y', (d) => yScale(d.id) ?? 0)
        .attr('height', yScale.bandwidth())
        .attr('rx', 3)
        .attr('fill', '#38bdf8')
        .attr('opacity', hoveredId === 'target' ? 0.55 : 0.95)
        .style('cursor', 'pointer')
        .on('mouseenter', () => setHoveredId('own'))
        .on('mouseleave', () => setHoveredId(null));

      if (transitionMs > 0) {
        secBars
          .attr('width', 0)
          .transition()
          .duration(transitionMs)
          .ease(d3.easeCubicOut)
          .attr('width', (d) => Math.max(2, xScale(d.totalValue) - xScale(d.primaryValue)));
      } else {
        secBars.attr('width', (d) => Math.max(2, xScale(d.totalValue) - xScale(d.primaryValue)));
      }
    }

    // Target threshold vertical dashed reference line
    const targetX = xScale(safeTarget);
    g.append('line')
      .attr('x1', targetX)
      .attr('x2', targetX)
      .attr('y1', -5)
      .attr('y2', innerHeight + 2)
      .attr('stroke', '#fb923c')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3');

    g.append('text')
      .attr('x', Math.min(innerWidth - 2, Math.max(18, targetX)))
      .attr('y', -7)
      .attr('text-anchor', targetX > innerWidth - 28 ? 'end' : 'middle')
      .attr('fill', '#fb923c')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .text(isOwnRuler ? 'Richtwert' : 'Zielwert');

    // Left category labels
    g.selectAll('text.volc-d3-label')
      .data(bars)
      .join('text')
      .attr('class', 'volc-d3-label')
      .attr('x', -8)
      .attr('y', (d) => (yScale(d.id) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', (d) => (d.id === 'own' ? '#f5efe6' : '#a89f94'))
      .attr('font-size', '11px')
      .attr('font-weight', (d) => (d.id === 'own' ? '600' : '500'))
      .text((d) => d.label);

    // Right tabular value labels
    g.selectAll('text.volc-d3-value')
      .data(bars)
      .join('text')
      .attr('class', 'volc-d3-value mono')
      .attr('x', innerWidth + 8)
      .attr('y', (d) => (yScale(d.id) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'start')
      .attr('fill', (d) => (d.id === 'own' ? ownFill : '#d6cdc2'))
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text((d) => `${formatKk(d.totalValue)}`);

    // Bottom X-axis ticks (compact tabular KK scale)
    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(ticks)
      .tickSize(3)
      .tickPadding(5)
      .tickFormat((d) => formatTickKk(Number(d)));

    const axisGroup = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    axisGroup.select('.domain').attr('stroke', 'rgba(245, 239, 230, 0.12)');
    axisGroup.selectAll('.tick line').attr('stroke', 'rgba(245, 239, 230, 0.14)');
    axisGroup
      .selectAll('.tick text')
      .attr('fill', '#8e857a')
      .attr('font-size', '10px')
      .attr('class', 'mono');
  }, [bars, containerWidth, hoveredId, isOwnRuler, ownTotal, readinessTone, safeTarget]);

  const activeDetail = hoveredId ? bars.find((b) => b.id === hoveredId)?.detail : null;

  return (
    <div className="volc-d3-wrap" ref={containerRef}>
      <div className="volc-d3-head">
        <span className="volc-d3-title">Stärke-Vergleich (KK)</span>
        <span className={`volc-d3-delta mono is-${readinessTone}`}>
          {diff >= 0 ? `+${formatKk(diff)} KK` : `−${formatKk(Math.abs(diff))} KK`}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="volc-d3-svg"
        role="img"
        aria-label={`Balkendiagramm Truppenstärke: Eigene Stärke ${formatKk(ownTotal)} KK gegenüber Zielwert ${formatKk(safeTarget)} KK`}
      />
      <div className="volc-d3-caption">
        <span>{activeDetail || readinessLabel}</span>
        {isOwnRuler && ownSecondary > 0 ? (
          <span className="volc-d3-legend">
            <span className="volc-d3-swatch is-garrison" aria-hidden="true" />
            <span>Garnison</span>
            <span className="volc-d3-swatch is-reinforce" aria-hidden="true" />
            <span>Verstärkung</span>
          </span>
        ) : null}
      </div>
    </div>
  );
};
