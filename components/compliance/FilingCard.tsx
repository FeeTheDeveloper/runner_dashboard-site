import React from 'react';

type FilingCardProps = {
  title: string;
  status: string;
};

export function FilingCard({ title, status }: FilingCardProps) {
  return (
    <article>
      <h3>{title}</h3>
      <p>{status}</p>
    </article>
  );
}
