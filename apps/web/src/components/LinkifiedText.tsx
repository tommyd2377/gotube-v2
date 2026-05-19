const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function cleanUrlMatch(value: string) {
  const trailingMatch = value.match(/[),.;!?]+$/);
  const trailing = trailingMatch?.[0] ?? "";
  const body = trailing ? value.slice(0, -trailing.length) : value;
  return { body, trailing };
}

export function LinkifiedText({ text }: { text?: string | null }) {
  if (!text) {
    return null;
  }

  const parts = text.split(urlPattern);
  return (
    <>
      {parts.map((part, index) => {
        urlPattern.lastIndex = 0;
        const isUrl = urlPattern.test(part);
        urlPattern.lastIndex = 0;
        if (!isUrl) {
          return <span key={`${index}-${part}`}>{part}</span>;
        }

        const { body, trailing } = cleanUrlMatch(part);
        const href = body.startsWith("http") ? body : `https://${body}`;
        return (
          <span key={`${index}-${part}`}>
            <a className="textLink" href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
              {body}
            </a>
            {trailing}
          </span>
        );
      })}
    </>
  );
}
