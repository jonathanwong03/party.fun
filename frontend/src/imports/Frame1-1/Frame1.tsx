function Group() {
  return (
    <div className="grid-cols-[max-content] grid-rows-[max-content] inline-grid leading-[0] mr-[-4.667px] place-items-start relative shrink-0">
      <div className="bg-[#00f991] col-1 h-[36px] ml-0 mt-0 relative row-1 w-[162px]" />
      <p className="[word-break:break-word] col-1 font-['Inter:Medium',sans-serif] font-medium leading-[27px] ml-[71px] mt-[4px] not-italic relative row-1 text-[14px] text-black whitespace-nowrap">$12</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="h-[36px] mr-[-4.667px] relative shrink-0 w-[162px]">
      <div className="absolute bg-[#fee900] h-[36px] left-0 top-0 w-[162px]" />
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[68.25px] not-italic text-[14px] text-black top-[4px] whitespace-nowrap">$18</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="h-[36px] mr-[-4.667px] relative shrink-0 w-[166px]">
      <div className="absolute bg-[#f46303] h-[36px] left-[0.5px] top-0 w-[166px]" />
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[77.5px] not-italic text-[14px] text-black top-[4px] whitespace-nowrap">$26</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="h-[36px] relative shrink-0 w-[172px]">
      <div className="absolute bg-[#ff0a0a] h-[36px] left-[5px] top-0 w-[176px]" />
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-[59px] not-italic text-[14px] text-white top-[4px] whitespace-nowrap">$40 flat</p>
    </div>
  );
}

export default function Frame() {
  return (
    <div className="relative rounded-[20px] size-full">
      <div className="content-stretch flex items-center justify-between overflow-clip relative rounded-[inherit] size-full">
        <Group />
        <Frame1 />
        <Frame2 />
        <Frame3 />
      </div>
      <div aria-hidden="true" className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[20px]" />
    </div>
  );
}